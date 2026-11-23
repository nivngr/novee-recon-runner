# NOTES

**Time spent:** ~22h (design and spikes ~10h, build ~12h).

The working record behind these notes: [`APPROACH.md`](APPROACH.md) (how I worked),
[`docs/decisions.md`](docs/decisions.md) (D1–D15: each choice, what I rejected, why),
[`docs/ai-log.md`](docs/ai-log.md), [`proofs/`](proofs/README.md), and the design in [`docs/design/`](docs/design/)
(a one-page [tech design](docs/design/tech-design.md), a [diagram](docs/design/system-diagram.html), the full
[build plan](docs/design/plan.md)).

---

## How to run it

*Details: every task in [`Taskfile.yml`](Taskfile.yml); the deployment design in [plan §8](docs/design/plan.md).*

**k3s flavour used:** k3d 5.9 (k3s in Docker). `task up` detects the flavour from the kube context and loads
images accordingly: `k3d image import` for k3d, nothing for OrbStack / Rancher Desktop (they share Docker's
images), `docker save | sudo k3s ctr images import -` for plain k3s.

**Needs on the machine:** Docker, `kubectl` pointed at the empty cluster, [Task](https://taskfile.dev) 3.x, and
internet access (npm packages, base images, and Temporal's test server for the tests). No Node: the deploy gate
runs in a container. The proofs also use `curl` and `jq`; developing (`task check`, `task test:db`) needs Node
22.12+.

```bash
# 0. Unpack the repo and go to its root; Docker running; kubectl's current context on the empty k3s cluster.
cd novee

# 1. Everything, in one command:
task up
#    = typecheck, lint, test in a container (refuses to deploy on any failure) → build all images from this
#      commit → load them into the cluster → namespace, Postgres, Temporal, agent-service → migrate Job → api,
#      worker ×2, web → wait for every rollout. ~3–4 min on a warm machine (218s on a freshly created k3d cluster).

# 2. Open it (leave running; Ctrl-C stops it):
task open
```

**The same, one step at a time** (exactly what `task up` runs, in order; each is a task you can run on its own):

```bash
task gate      # the deploy gate, in Docker: Prisma client, typecheck, lint, unit + workflow tests
task build     # docker build: api, worker, web, migrate, and the given agent-service, tagged with the commit
task load      # the image-load step: into the cluster, by flavour (k3d image import / nothing / k3s ctr import)
task infra     # namespace, Postgres, Temporal, agent-service (the starter's manifests, unchanged); waits for them
task migrate   # the migrate Job: Prisma migrations, once; waits for it and prints its log
task apps      # api, worker ×2, web; waits for every rollout
task open      # port-forwards the app and Temporal's Web UI
```

**Then open:** http://localhost:3000 (the app) and http://localhost:8234 (Temporal's Web UI).

No cluster yet? `task cluster` creates a local k3d one. `task down` deletes the namespace. Proofs: `task proof:r1`
… `task proof:r9` (see [`proofs/README.md`](proofs/README.md)).

---

## The architecture I arrived at, and why

*Details: each choice with what I rejected in [`docs/decisions.md`](docs/decisions.md) (the D1–D15 references below);
the short version in the [tech design](docs/design/tech-design.md), the picture in the
[diagram](docs/design/system-diagram.html).*

**The services:**

| | |
|---|---|
| **web** (Next.js) | The UI. Polls the API and forwards `/api/*` to it through a small route handler; no logic of its own. |
| **api** (Fastify) | Validates requests, saves runs, starts / signals / cancels workflows, serves what the UI shows. |
| **worker** (×2, no Service) | Runs the `recon` workflow (the decisions) and its activities (agent-service and Postgres calls). |
| **packages/contracts** | zod schemas and the shared vocabulary (statuses, legality table): one definition for api, worker and web. |
| **packages/db** | Prisma schema, migrations, and the only code that writes Postgres. |
| Temporal, Postgres, agent-service | As given: the starter's manifests, unchanged. Temporal's `securityContext` needed no change on k3d. |

**The tables:** Prisma migrations (run once by the migrate Job) create them; the starter's `db/schema.sql` isn't
applied. Same three table names and the same meaning, plus: a `staged_discoveries` table (raw agent output, before
approval), unique keys that make every write repeatable (one row per agent index, each domain once per run),
Postgres enums for every status, `CHECK`s on the value ranges the API also validates, and a `failure_code` on
failed runs.

**Why this split:** the workflow has to be crash-proof and replayable, so it lives in the worker and touches
nothing directly; everything with side effects is an activity that's safe to repeat. The UI reads a **read model
in Postgres** that the workflow keeps up to date (D5), not Temporal queries, so it works while every worker is
down. Findings never pass through Temporal: each agent's results go straight into a Postgres staging table,
and approve copies the deduplicated set (each subdomain once, at its most severe risk) into
`discovered_domains` in one transaction (D4). Staged findings are kept for every run, approved or not, as raw
agent output.

**What I rejected, and why:**
- **A child workflow per agent** (D2): a cleaner unit, but more history and moving parts for ≤ 20 agents. Would
  change at hundreds of agents per run.
- **Temporal queries for the UI** (D5): they need a live worker (a query hung 29s with none, spike 02).
- **Temporal updates for approve / window** (D8): an update needs a worker to answer; a signal is stored and
  applied later (spike 05).
- **The API generating run ids, plus a sweeper for half-made runs** (D12): the browser makes the id instead, so a
  repeated submit is harmless and a half-finished one is completed by retrying it.
- **Server-sent events** (D11): progress changes every second anyway; polling fits the read model.
- **tRPC / GraphQL** (D13): REST is what `curl`, the proofs and you use; shared zod still gives end-to-end types.
- **Go** (D1): TypeScript's workflow sandbox makes the non-deterministic mistakes harder to make, and one language
  covers the stack.

**How my concurrency window works:** a counter inside the workflow, with no external queue or lock.
- The workflow loops over the agents. Before starting agent *i* it waits on `condition(() => running < window)`.
  Each agent runs in a "lane" (start → watch → maybe stop) whose `finally` does `running -= 1`.
- **A slot frees** the moment a lane ends, for any reason (completed, failed, written off, stopped). Temporal
  re-evaluates the condition after every event, so the next agent starts in the same step: sliding, never batched.
  R1 measured each refill ≤ 1s after the finish that freed it.
- **A mid-run change** is a `setWindow` signal. The handler checks it's legal (running, 1..agentCount) and sets
  `window`; the same condition picks it up. Raising starts more right away; lowering only holds back new starts,
  and nothing running is killed.
- **An agent that never finishes** can't hold a slot forever. Its `waitAgent` activity polls agent-service every
  second and gives up after `stallTimeoutS` without progress (default 60s) or `maxAgentDurationS` in total
  (default 300s). The workflow then stops it and records it `LOST` (`NO_PROGRESS` / `CEILING`). If the *worker*
  dies instead, the activity's 10s heartbeat lapses and Temporal reruns it on the other replica, which carries
  on polling the same scan.
- The first agent starts alone, so an unsupported domain is refused after exactly one start attempt (R5).

**My HTTP API:** REST, request and response shapes as zod schemas in `packages/contracts`, parsed by the API on
the way in and by the browser on the way out. Errors are always `{ error, message }`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/assessments` | Submit `{ id, domain, agentCount, windowSize, settings? }`. 201 new, 200 the same request repeated, 409 same id with different parameters. |
| `GET` | `/assessments?limit=` | Recent runs, with any pending request. |
| `GET` | `/assessments/{id}` | The run: status, pending request, counts, summary, agents, **`allowedActions`**, failure, and `stuck` if its workflow keeps failing. |
| `GET` | `/assessments/{id}/domains` | Before approve: the deduplicated staged findings (with how many agents found each). After: the stored result. |
| `POST` | `/assessments/{id}/approve` · `/reject` · `/cancel` | 202 accepted; 409 if not allowed now (checked against the legality table, then again in the workflow). |
| `PUT` | `/assessments/{id}/window` | `{ size }`: change the window mid-run. |
| `GET` | `/healthz` · `/livez` | Readiness (database + Temporal) · liveness (the process answers). |

**Statuses** are the brief's: `RUNNING`, `AGGREGATING`, `AWAITING_APPROVAL` (awaiting a human), `PERSISTING`,
then `COMPLETED`, `REJECTED`, `REJECTED_INPUT`, `CANCELLED`, `FAILED`. I added `STARTING`, the moment between submit
and the workflow's first step.

---

## How I proved each requirement

*Details: every script and its full output in [`proofs/`](proofs/README.md).*

Each proof is a script against the deployed stack that starts by resetting agent-service and prints
`PASS`/`FAIL` per check; outputs are saved next to them. All nine passed in one pass on a freshly created cluster,
with agent-service's default timings.

| | Requirement | Status | How I checked |
|---|---|---|---|
| R1 | Window holds, and resizes mid-run | ✅ | 6 agents, window 2: `maxConcurrent` 2, each refill ≤ 1s after a finish. Raised to 4 mid-run → 4; lowered to 1 → nothing stopped, all 6 completed. |
| R2 | Survives a worker crash | ✅ | Deleted every worker pod mid-run: replacements ready 5s later and finished it. `totalStarted` 6 for 6 agents; stored = the distinct union of what they found (707), and = agent-service's own count from its completed scans (the starter's check). |
| R3 | Recorded exactly once | ✅ | Every activity fails its first 2 attempts *after* its side effect, on top of agent-service's 503s: 4 started for 4, 4 agent rows, every domain stored once (591, = agent-service's own count). Plus database tests: approve twice, complete twice → same rows. |
| R4 | Bulk results stay out of the workflow | ✅ | Read the run's history from Temporal: every activity result 0–69 bytes, largest payload 182 bytes, no found subdomain in it; the 1,000 findings are only in Postgres. |
| R5 | Failures classified, partial failure survived | ✅ | `.invalid` domain → `REJECTED_INPUT` in 3s, one start attempt, `totalStarted` 0. `failEveryN=3` → 2 FAILED, run completes with 4. `stallEveryN=3` → 2 LOST (no progress), stops confirmed. |
| R6 | Human gate is real | ✅ | While waiting: findings readable, 0 rows stored, early approve refused (409). Approve → exactly the listed domains stored; reject → 0 stored, staged findings kept. |
| R7 | Cancellation stops the agents | ✅ | Cancel with 2 in flight: both scans STOPPED at agent-service (confirmed), 4 queued never started, nothing RUNNING, run and workflow CANCELLED. |
| R8 | Frontend tells the truth | ✅ | Playwright drives a real run (video in `proofs/videos/r8/`): never terminal early, buttons from `allowedActions`, polling stops at the end, and the page matches the API at stable points. Buttons are also disabled while their request is in flight (in the code, not separately tested). Plus manual testing (see A4). |
| R9 | Deployable like a k8s citizen | ✅ | Recreated the k3d cluster, `task up`: exit 0 in 218s. Worker ×2, no Service, exec liveness probe (a file the worker refreshes every 10s while it's running), resource requests and limits; a deleted worker pod is replaced. |

**Skipped or partial:** no requirement skipped. Partial: buttons are disabled while their own request is in
flight, but only the code does that; no test checks it. The proofs used agent-service's default timings and
fault knobs, so your settings (other `failFirstN`, `failEveryN`, `stallEveryN`, durations) weren't each tried
beyond what R3 and R5 cover.

**What each activity puts in the history (R4):** only small values, never findings.

| Activity | Returns |
|---|---|
| `startAgent` | the scan id |
| `waitAgent` | the outcome, plus a count when it completed |
| `aggregate` | the run's summary: a count per risk level |
| `setRunStatus` | whether the status moved (a boolean) |
| `persist`, `stopAgent`, `markStartFailed`, `markStopUnconfirmed` | nothing |

The largest payload anywhere in a run's history, inputs included, was 182 bytes.

**My retry switch for R3:** `settings.failFirstAttempts` (0–5) on the submit request, or *Advanced → Fail first
attempts* in the form. Per run, so no redeploy: every activity of that run throws a retryable failure on its first
N attempts, right after doing its work, as if the worker died before reporting success.

**`maxConcurrent` / `totalStarted` from my best run:** `maxConcurrent` 2 at window 2, `totalStarted` 6 for 6 agents
(R1); `totalStarted` 6 for 6 with every worker killed mid-run (R2).

**Tests that would catch a real regression** (all in `task check`, and in the same steps in `task gate`, which gates every deploy): the window (fails on
fan-out or batching), resize, cancel and bad-domain workflow tests in Temporal's time-skipping server; a replay of a
real recorded run (fails if a change would break runs in flight); approve / complete twice against a real Postgres
(`task test:db`); a compile-time check that the database enums and the shared vocabulary match.

---

## Trade-offs, and my AI log

*Details: the full log in [`docs/ai-log.md`](docs/ai-log.md) (the A1–A6 references below).*

**What I deliberately did not do, and why:**
- **No user accounts or target authorisation.** The brief has none; in a real recon product, checking that a user
  may scan a domain comes first.
- **No expiry for runs awaiting approval.** A run waits for a human indefinitely (it costs nothing while it waits).
- **No retention policy for staged findings.** Kept for every run as raw agent output; deleting nothing was a choice.
- **No Worker Versioning.** A breaking change to the workflow is handled with temporary compatibility code instead
  (see A4).
- **The browser test isn't part of the deploy gate.** It's heavy and slow; it's a proof you run deliberately.
- **Node on the host** for the deploy gate, rather than running the checks in a container: simpler, one more
  prerequisite.
- **Stuck detection, not a hard stop.** A workflow whose code keeps failing retries until it's fixed, then resumes
  (it did, see A4). The UI says it's stuck instead of pretending to progress.

**Assumptions** where the brief was open: "persisted" means the `discovered_domains` table, written only by approve;
an agent is written off after 60s without progress or 300s in total (per-run settings); at most 20 agents per run;
the first agent starts alone so an unsupported domain is caught after one attempt.

**Where my AI agent got it wrong on the first pass.** I didn't hand the task to an agent and fix the result; I
built it with the agent, under explicit rules (the [`CLAUDE.md`](CLAUDE.md) files in the repo):
- **Design first,** one decision at a time, each with what was rejected written down. (Early on, the agent padded
  the "rejected" lists with options nobody would choose; I made it list only genuine ones.)
- **Spike before relying** on anything external (Temporal, agent-service, Prisma, k8s), and mark claims taken
  from docs as unverified until a spike confirms them. (One such claim turned out wrong, harmlessly.)
- **Review at every milestone,** then repeatable proofs, testing by hand, and a dry run of these notes.

So most mistakes were caught early, by a rule or a check I set, rather than found in finished code. Each entry
says what caught it:

1. **R2 (A4): new code broke runs that had started under the old code.** The agent changed the shape of the data
   a run starts with. Temporal finishes old runs with the new code, which couldn't read their old data, so two runs
   waiting for approval got stuck on "approving…". It had assumed no old runs would be affected, and replaced the
   one test that would have caught it. **I caught it testing by hand:** I approved one of those runs and it never
   finished. Fix: accept both shapes until those runs finished, then delete the extra code; a workflow's input now
   only ever gets added to. In production: Temporal's Worker Versioning.
2. **R8 (A5): a run whose workflow was crashing looked like it was progressing.** During that bug the page said
   "approving…" for minutes; the design's safety net only caught workflows that had *ended*. **I caught it by
   asking whether "approving…" was honest** while watching a run that would never finish. Fix: the page now says
   when a run is stuck, and on what.
3. **R7 (A1): cancelling left runs stuck, and could never finish.** The agent left the running agents'
   cancellation errors unhandled (the SDK then retries the workflow step forever), and treated agent-service's 404
   on stop as retryable. **Caught by spike-first:** spike 03 exercised cancellation before the real workflow
   existed; all three scenarios stayed `RUNNING`.
4. **R9, R3 (A2): the plan relied on two things that couldn't have worked.** Alpine images, but Temporal's worker
   ships its native library for glibc only, so it could never have started; and the approve statement as TypedSQL,
   which needs a live database to build, while image builds have none. **Caught by verifying before relying:**
   listing the SDK's binaries before the first Dockerfile, running the generator without a database before the
   data layer.
5. **R6 (A3): the Approve button did nothing.** The UI's proxy labelled approve's empty body as JSON; the API
   framework refused it in its own error format, so the decision never arrived. **Caught by the browser test,**
   which timed out on "Awaiting approval" after the click.
6. **R9 (A6): a zip submission couldn't run `task up`.** Images were tagged with the git commit hash, and a zip has
   no `.git`, so every task failed at once. **Caught by the dry run I required,** following these notes literally
   from a clean copy of the repo. Now a zip uses a hash of the sources instead.

Smaller catches (a false pass in a spike's test, tests running against a stale build, an approve that could be
dropped, caught in review before the code first ran, …) are kept in the log, below the bar.
---

## What I would do next

*Details: each item's trigger was recorded where it came up, in the decisions and the [plan](docs/design/plan.md).*

- **Worker Versioning** once workflow changes are frequent: each build its own worker Deployment, old runs stay on
  it until they finish, `task up` promotes the new version, a cleanup removes drained ones.
- **User accounts**, and verifying a user may assess the target domain.
- **A retention policy** for staged findings (e.g. purge rejected or out-of-scope targets after N days), and an
  expiry for runs left awaiting approval.
- **An append-only events table**, once the audit trail must outlive Temporal's retention (24h here).
- **A minimum success ratio** before a run reaches approval (today a run with one completed agent of twenty asks for
  a decision).
- **Child workflows per agent**, at hundreds of agents per run.
- **Push updates**, once many people watch runs that wait long for approval.
- **Alerts** on stuck runs, instead of only the banner.
