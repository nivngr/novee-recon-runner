// agent-service is the long-running dependency for the Novee fullstack home task.
//
// It runs "AI recon agents". Starting a scan is cheap and returns immediately; the agent
// then works for somewhere between 10s and 2m before producing a list of discovered
// subdomains, each with a risk rating. Candidates orchestrate many of these under a
// concurrency window; this service is given.
//
// Candidates must NOT modify this file. Its behaviour is the exercise:
//
//   - a scan takes 10s-2m, so the workflow has to poll rather than block on a response
//   - it tracks the high-water mark of concurrently running scans, so a concurrency
//     window can be verified rather than taken on trust
//   - repeat starts create repeat agents unless an Idempotency-Key is supplied
//   - POST /scans fails transiently (503) and permanently (422), differently
//   - an agent can also fail *in band*: HTTP 200 with status FAILED
//   - results are a deterministic function of the scan, so a replay must reproduce them
//   - different techniques against the same domain discover overlapping but different
//     sets, so more agents means broader coverage and the union needs deduplicating
//
// Two deliberate kindnesses, so candidates can test their own work:
//
//   - a scan's duration is derived from its id rather than rolled fresh, so it looks
//     spread across the range but is stable for a given scan
//   - every fault is adjustable at runtime via POST /admin/config
//
// stdlib only, single file, no go.mod dependencies.
package main

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------- config

type config struct {
	// FailFirstN transient 503s on POST /scans, per domain, before the first success.
	FailFirstN int `json:"failFirstN"`
	// FailEveryN makes every Nth agent end in status FAILED. 0 disables.
	FailEveryN int `json:"failEveryN"`
	// StallEveryN makes every Nth agent hang: progress freezes and it never reaches a
	// terminal status at all. 0 disables. Nothing errors, so nothing is retried — the
	// only defence is a ceiling on how long you will wait for one agent.
	StallEveryN int `json:"stallEveryN"`
	// MaxConcurrent, when > 0, makes POST /scans return 429 once this many agents are
	// already running. 0 means unlimited — the default, so that a missing concurrency
	// window fails silently rather than loudly.
	MaxConcurrent int `json:"maxConcurrent"`
	// MinDurationMs / MaxDurationMs bound how long an agent runs. Turn these down while
	// iterating; the defaults are what we test against.
	MinDurationMs int `json:"minDurationMs"`
	MaxDurationMs int `json:"maxDurationMs"`
	// ResultCount is how many subdomains a completed agent discovers.
	ResultCount int `json:"resultCount"`
}

func defaultConfig() config {
	return config{
		FailFirstN:    envInt("FAIL_FIRST_N", 2),
		FailEveryN:    envInt("FAIL_EVERY_N", 0),
		StallEveryN:   envInt("STALL_EVERY_N", 0),
		MaxConcurrent: envInt("MAX_CONCURRENT", 0),
		MinDurationMs: envInt("MIN_DURATION_MS", 10_000),
		MaxDurationMs: envInt("MAX_DURATION_MS", 120_000),
		ResultCount:   envInt("RESULT_COUNT", 250),
	}
}

// ---------------------------------------------------------------- model

type status string

const (
	statusRunning   status = "RUNNING"
	statusCompleted status = "COMPLETED"
	statusFailed    status = "FAILED"
	statusStopped   status = "STOPPED"
)

// techniques are the recon methods an agent can run. Each one explores the namespace
// differently, so pointing several at the same domain is worth more than pointing one at
// it several times.
var techniques = []string{"dns-brute", "cert-transparency", "passive-dns", "web-crawl"}

func validTechnique(t string) bool {
	for _, k := range techniques {
		if k == t {
			return true
		}
	}
	return false
}

type discovery struct {
	Domain string `json:"domain"`
	// Risk is CRITICAL, HIGH, MEDIUM or LOW, derived from what the hostname suggests
	// the thing is. An admin panel or a CI server matters more than a docs site.
	Risk string `json:"risk"`
}

type scan struct {
	ID        string  `json:"scanId"`
	Domain    string  `json:"domain"`
	Technique string  `json:"technique"`
	Status    status  `json:"status"`
	Progress  float64 `json:"progress"`
	// Reason is set when Status is FAILED. The only value is agent_crashed: this agent is
	// lost, so do not start a replacement. Unsupported domains never get this far; they
	// are refused at POST /scans with a 422.
	Reason string `json:"reason,omitempty"`
	// Discovered is null until the scan reaches COMPLETED.
	Discovered []discovery `json:"discovered"`

	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	DurationMs int        `json:"plannedDurationMs"`

	// not serialised
	endsAt    time.Time
	seed      uint32
	willFail  bool
	willStall bool
}

// view materialises the caller-visible state of a scan at time now.
//
// A scan has no goroutine behind it — "running" is just a comparison against endsAt. So
// the service holds no timers, survives being polled at any rate, and cannot drift from
// what it reports.
func (s *scan) view(now time.Time, cfg config) scan {
	out := *s

	// A stalled agent freezes partway and stays RUNNING forever. Deliberately: it never
	// errors, so no retry policy will ever notice it.
	if s.Status == statusRunning && s.willStall {
		out.Progress = 0.4
		return out
	}

	if s.Status == statusRunning && !now.Before(s.endsAt) {
		fin := s.endsAt
		out.FinishedAt = &fin
		out.Progress = 1
		if s.willFail {
			out.Status = statusFailed
			out.Reason = "agent_crashed"
		} else {
			out.Status = statusCompleted
			out.Discovered = discoveriesFor(s.Domain, s.seed, cfg.ResultCount)
		}
		return out
	}

	if s.Status == statusRunning {
		elapsed := now.Sub(s.StartedAt).Seconds()
		total := s.endsAt.Sub(s.StartedAt).Seconds()
		if total > 0 {
			out.Progress = round2(elapsed / total)
		}
	}
	return out
}

// ---------------------------------------------------------------- results

var (
	// Things that being exposed is a problem.
	criticalLabels = map[string]bool{
		"admin": true, "jenkins": true, "vpn": true, "internal": true,
		"legacy": true, "registry": true, "git": true, "sso": true,
	}
	// Things that should not be reachable but often are.
	highLabels = map[string]bool{
		"staging": true, "dev": true, "qa": true, "uat": true, "sandbox": true,
		"test": true, "preview": true, "dashboard": true, "grafana": true,
		"kibana": true, "jira": true, "billing": true, "payments": true,
		"auth": true, "secure": true, "reports": true, "ci": true,
	}

	labels = []string{
		"api", "app", "admin", "auth", "beta", "billing", "cdn", "ci", "dashboard", "dev",
		"docs", "edge", "files", "git", "grafana", "internal", "jenkins", "jira", "kibana",
		"legacy", "mail", "metrics", "mobile", "mx", "ns1", "ns2", "origin", "partner",
		"payments", "portal", "preview", "prod", "qa", "registry", "reports", "sandbox",
		"secure", "shop", "smtp", "sso", "staging", "static", "status", "support", "test",
		"uat", "vpn", "web", "webhooks", "wiki",
	}
	suffixes = []string{"", "-01", "-02", "-eu", "-us", "-old", "-new", "-tmp", "2", "3"}
)

func riskFor(label string, h uint32) string {
	switch {
	case criticalLabels[label]:
		return "CRITICAL"
	case highLabels[label]:
		return "HIGH"
	case h%3 == 0:
		return "MEDIUM"
	default:
		return "LOW"
	}
}

// discoveriesFor derives an agent's findings from its seed.
//
// Deterministic, so "same scan, same result, forever" holds — which is what makes "did
// your workflow replay correctly?" a decidable question instead of a matter of opinion.
// The seed comes from the scan id, which encodes the domain and the technique, so two
// agents on the same domain overlap without being identical.
func discoveriesFor(domain string, seed uint32, count int) []discovery {
	if count < 0 {
		count = 0
	}
	out := make([]discovery, 0, count)
	seen := make(map[string]struct{}, count)

	for i := 0; len(out) < count; i++ {
		h := seed ^ (uint32(i) * 2654435761)
		label := labels[int(h>>7)%len(labels)]
		name := label + suffixes[int(h>>17)%len(suffixes)]
		if int(h>>27)%8 == 0 {
			// Occasionally a deeper label, so nobody assumes exactly one level.
			name += "." + labels[int(h>>3)%len(labels)]
		}
		fqdn := name + "." + domain
		if _, dup := seen[fqdn]; dup {
			continue
		}
		seen[fqdn] = struct{}{}
		out = append(out, discovery{Domain: fqdn, Risk: riskFor(label, h)})
	}
	return out
}

// ---------------------------------------------------------------- server

type server struct {
	mu   sync.Mutex
	cfg  config
	seq  int
	scan map[string]*scan

	// startsByDomain counts agents actually started per domain — an idempotent replay
	// does not increment it. This is how "exactly N agents ran" is checked.
	startsByDomain map[string]int
	// attemptsByDomain counts POST /scans attempts per domain, including the 503s.
	attemptsByDomain map[string]int
	// maxConcurrent is the high-water mark of simultaneously RUNNING scans. A
	// concurrency window is a claim about this number.
	maxConcurrent int
}

func newServer() *server {
	return &server{
		cfg:              defaultConfig(),
		scan:             map[string]*scan{},
		startsByDomain:   map[string]int{},
		attemptsByDomain: map[string]int{},
	}
}

// unsupported mirrors a permanently bad input: nothing about retrying will help.
func unsupported(domain string) bool {
	d := strings.ToLower(strings.TrimSpace(domain))
	switch {
	case d == "", strings.Contains(d, " "), strings.Contains(d, "/"):
		return true
	case !strings.Contains(d, "."), strings.HasPrefix(d, "."), strings.HasSuffix(d, "."):
		return true
	}
	return strings.HasSuffix(d, ".invalid") || strings.HasSuffix(d, ".unsupported")
}

type startRequest struct {
	Domain    string `json:"domain"`
	Technique string `json:"technique"`
}

// handleStart launches an agent.
//
// The Idempotency-Key header is the whole game here. With one, the scan id is derived
// from (domain, technique, key): a retried start returns the *same* agent and does not
// launch a second one. Without one, every call launches another agent — which is what an
// activity retry looks like when nobody thought about it.
func (s *server) handleStart(w http.ResponseWriter, r *http.Request) {
	var req startRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	technique := strings.ToLower(strings.TrimSpace(req.Technique))
	if technique == "" {
		technique = techniques[0]
	}
	key := r.Header.Get("Idempotency-Key")

	if !validTechnique(technique) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "unknown_technique", "supported": techniques,
		})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()

	if unsupported(domain) {
		log.Printf("start domain=%q -> 422 unsupported_domain", domain)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"error": "unsupported_domain", "domain": domain,
		})
		return
	}

	s.attemptsByDomain[domain]++
	if n := s.attemptsByDomain[domain]; n <= s.cfg.FailFirstN {
		log.Printf("start domain=%q attempt=%d -> 503 agent_pool_exhausted (failFirstN=%d)",
			domain, n, s.cfg.FailFirstN)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "agent_pool_exhausted",
		})
		return
	}

	id := ""
	if key != "" {
		id = scanID(domain, technique, key)
		if existing, ok := s.scan[id]; ok {
			log.Printf("start domain=%q technique=%s key=%q -> 200 replay of %s",
				domain, technique, key, id)
			writeJSON(w, http.StatusOK, existing.view(now, s.cfg))
			return
		}
	} else {
		s.seq++
		id = scanID(domain, technique, fmt.Sprintf("#anon-%d", s.seq))
	}

	// Optional hard cap. Off by default: we would rather a missing window show up as a
	// high maxConcurrent than be papered over by us saying no.
	if s.cfg.MaxConcurrent > 0 && s.runningLocked(now) >= s.cfg.MaxConcurrent {
		log.Printf("start domain=%q -> 429 too_many_agents (cap=%d)", domain, s.cfg.MaxConcurrent)
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error": "too_many_agents", "maxConcurrent": s.cfg.MaxConcurrent,
		})
		return
	}

	s.launchLocked(id, domain, technique, now)
	writeJSON(w, http.StatusAccepted, s.scan[id].view(now, s.cfg))
}

// launchLocked creates a scan. Caller holds the mutex.
func (s *server) launchLocked(id, domain, technique string, now time.Time) {
	seed := hash(id)

	// Spread across [min,max] but stable for this scan id, so timing experiments are
	// repeatable and a reattach after a worker crash sees the finish time it would
	// have seen anyway.
	span := s.cfg.MaxDurationMs - s.cfg.MinDurationMs
	if span < 0 {
		span = 0
	}
	durationMs := s.cfg.MinDurationMs
	if span > 0 {
		durationMs += int(seed>>9) % span
	}

	s.startsByDomain[domain]++
	nth := s.startsByDomain[domain]

	sc := &scan{
		ID:         id,
		Domain:     domain,
		Technique:  technique,
		Status:     statusRunning,
		StartedAt:  now,
		DurationMs: durationMs,
		endsAt:     now.Add(time.Duration(durationMs) * time.Millisecond),
		seed:       seed,
		willFail:   s.cfg.FailEveryN > 0 && nth%s.cfg.FailEveryN == 0,
		willStall:  s.cfg.StallEveryN > 0 && nth%s.cfg.StallEveryN == 0,
	}
	s.scan[id] = sc

	if running := s.runningLocked(now); running > s.maxConcurrent {
		s.maxConcurrent = running
	}
	log.Printf("start domain=%q technique=%s -> %s for %dms (concurrent=%d, max=%d, fail=%v, stall=%v)",
		domain, technique, id, durationMs, s.runningLocked(now), s.maxConcurrent,
		sc.willFail, sc.willStall)
}

// runningLocked counts scans that are RUNNING as of now. Caller holds the mutex.
func (s *server) runningLocked(now time.Time) int {
	n := 0
	for _, sc := range s.scan {
		if sc.view(now, s.cfg).Status == statusRunning {
			n++
		}
	}
	return n
}

func (s *server) handleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	s.mu.Lock()
	sc, ok := s.scan[id]
	cfg := s.cfg
	s.mu.Unlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown_scan"})
		return
	}
	writeJSON(w, http.StatusOK, sc.view(time.Now(), cfg))
}

// handleStop stops an agent. Idempotent: stopping an agent that has already finished, or
// has already been stopped, is not an error.
func (s *server) handleStop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	sc, ok := s.scan[id]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown_scan"})
		return
	}

	current := sc.view(now, s.cfg)
	if current.Status != statusRunning {
		log.Printf("stop %s -> already %s", id, current.Status)
		writeJSON(w, http.StatusOK, current)
		return
	}

	sc.Status = statusStopped
	sc.Progress = current.Progress
	sc.willStall = false
	fin := now
	sc.FinishedAt = &fin
	log.Printf("stop %s -> STOPPED at progress %.2f", id, sc.Progress)
	writeJSON(w, http.StatusAccepted, sc.view(now, s.cfg))
}

// ---------------------------------------------------------------- admin

type adminScan struct {
	ScanID     string     `json:"scanId"`
	Domain     string     `json:"domain"`
	Technique  string     `json:"technique"`
	Status     status     `json:"status"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	DurationMs int        `json:"plannedDurationMs"`
	Discovered int        `json:"discoveredCount"`
}

// handleAdminScans is the observation surface. Everything a candidate needs in order to
// check their own work — and everything we check — is derivable from this one response.
func (s *server) handleAdminScans(w http.ResponseWriter, _ *http.Request) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	out := struct {
		MaxConcurrent  int            `json:"maxConcurrent"`
		RunningNow     int            `json:"runningNow"`
		TotalStarted   int            `json:"totalStarted"`
		StartsByDomain map[string]int `json:"startsByDomain"`
		Scans          []adminScan    `json:"scans"`
	}{
		MaxConcurrent:  s.maxConcurrent,
		RunningNow:     s.runningLocked(now),
		StartsByDomain: map[string]int{},
		Scans:          make([]adminScan, 0, len(s.scan)),
	}

	for d, n := range s.startsByDomain {
		out.StartsByDomain[d] = n
		out.TotalStarted += n
	}
	for _, sc := range s.scan {
		v := sc.view(now, s.cfg)
		out.Scans = append(out.Scans, adminScan{
			ScanID: v.ID, Domain: v.Domain, Technique: v.Technique, Status: v.Status,
			StartedAt: v.StartedAt, FinishedAt: v.FinishedAt,
			DurationMs: v.DurationMs, Discovered: len(v.Discovered),
		})
	}
	// Sorted by start time so the response reads as a timeline: with a window of W, no
	// more than W of these overlap at any instant.
	sort.Slice(out.Scans, func(i, j int) bool {
		return out.Scans[i].StartedAt.Before(out.Scans[j].StartedAt)
	})

	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleConfig(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	next := s.cfg
	s.mu.Unlock()

	if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_config"})
		return
	}

	s.mu.Lock()
	s.cfg = next
	s.mu.Unlock()

	log.Printf("config updated: %+v", next)
	writeJSON(w, http.StatusOK, next)
}

func (s *server) handleReset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.cfg = defaultConfig()
	s.scan = map[string]*scan{}
	s.startsByDomain = map[string]int{}
	s.attemptsByDomain = map[string]int{}
	s.maxConcurrent = 0
	s.seq = 0
	s.mu.Unlock()

	log.Print("agents, counters and config reset")
	writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
}

// ---------------------------------------------------------------- helpers

func scanID(domain, technique, key string) string {
	return fmt.Sprintf("s-%08x", hash(domain+"|"+technique+"|"+key))
}

func hash(s string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return h.Sum32()
}

func round2(f float64) float64 {
	if f < 0 {
		return 0
	}
	if f > 1 {
		return 1
	}
	return float64(int(f*100+0.5)) / 100
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func envInt(key string, fallback int) int {
	if raw := os.Getenv(key); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			return v
		}
		log.Printf("ignoring non-integer %s=%q, using %d", key, raw, fallback)
	}
	return fallback
}

func main() {
	s := newServer()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /techniques", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"techniques": techniques})
	})
	mux.HandleFunc("POST /scans", s.handleStart)
	mux.HandleFunc("GET /scans/{id}", s.handleGet)
	mux.HandleFunc("POST /scans/{id}/stop", s.handleStop)
	mux.HandleFunc("GET /admin/scans", s.handleAdminScans)
	mux.HandleFunc("POST /admin/config", s.handleConfig)
	mux.HandleFunc("POST /admin/reset", s.handleReset)

	addr := ":" + os.Getenv("PORT")
	if addr == ":" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("agent-service listening on %s with %+v", addr, s.cfg)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
