# Proofs

One script per requirement, run against the deployed stack, each with its captured output (`rN-*.out`, written by
`task proof:rN`). Every script starts by resetting agent-service (`POST /admin/reset`: default config, counters
zeroed), so it's repeatable; proof scripts may call `/admin/*`, our services never do. Each check prints
`PASS`/`FAIL`, and the script exits non-zero on any failure.

```sh
task proof:r1            # one proof; output saved to proofs/r1-window.out
RECREATE=1 task proof:r9 # R9 from scratch: delete and recreate the local k3d cluster, then `task up`
```

Needs `kubectl` pointed at the cluster, `curl` and `jq`. The scripts port-forward the API and agent-service
themselves. R8 is the Playwright browser test (`task test:e2e`): heavy, so run it deliberately.

| Req | Script | What it shows | Status |
|---|---|---|---|
| R1 | [`r1-window.sh`](r1-window.sh) | 6 agents at window 2: agent-service's `maxConcurrent` is exactly 2, and every start after the first two comes ≤ 1s after the finish that freed its slot. A second run raised to 4 mid-run reaches 4; lowering to 1 stops nothing (0 stopped, 6 completed). | PASS |
| R2 | [`r2-crash.sh`](r2-crash.sh) | Every worker pod deleted mid-run: replacements ready 5s later and they finish the run (the agent table shows the new pod names). agent-service started exactly 6 agents for 6; stored = the distinct union of what they found (707), and the same number agent-service gives from its own completed scans (the starter README's check). | PASS |
| R3 | [`r3-exactly-once.sh`](r3-exactly-once.sh) | Every activity fails its first 2 attempts right after its side effect (all 14 succeeded on attempt 3), on top of agent-service's own 503s: 4 agents started for 4, 4 agent rows, no duplicate staged rows, every domain stored once (591, matching agent-service's own count). | PASS |
| R4 | [`r4-history.sh`](r4-history.sh) | Each activity's result as stored in Temporal's history: 0–69 bytes (a scan id, an outcome, a summary). Largest payload anywhere in the history: 182 bytes; no found subdomain appears in it. The 1,000 findings live only in Postgres. | PASS |
| R5 | [`r5-failures.sh`](r5-failures.sh) | An unsupported domain: REJECTED_INPUT in 3s, one start attempt, nothing started. Crashing agents (`failEveryN=3`): 2 FAILED, the run completes with the other 4, none replaced. Hanging agents (`stallEveryN=3`): 2 LOST (no progress), stops confirmed, nothing left running. | PASS |
| R6 | [`r6-human-gate.sh`](r6-human-gate.sh) | While awaiting approval: findings readable (staged), 0 rows stored, approve before then refused. Approved: exactly the listed domains stored (521). Rejected: 0 stored, staged findings kept, no further actions. | PASS |
| R7 | [`r7-cancel.sh`](r7-cancel.sh) | Cancel with 2 agents in flight: CANCELLED within seconds, both scans STOPPED at agent-service (confirmed), 4 queued agents never started, nothing RUNNING, Temporal shows the workflow canceled. | PASS |
| R8 | [`r8-ui.sh`](r8-ui.sh) | Playwright drives a real run in the browser (3.3 min, video in `videos/r8/`): status never terminal early, buttons follow `allowedActions`, domains "not stored yet" → "stored", polling stops at the end, no errors; and at stable points the page matches the API's own answer. | PASS |
| R9 | [`r9-deploy.sh`](r9-deploy.sh) | `k3d cluster delete` + create, then `task up`: exit 0 in 218s. All Deployments ready; 2 workers, no Service selecting them, exec liveness probe, memory limit; migrate Job succeeded; a deleted worker pod is replaced. | PASS |

All nine passed in one 32-minute pass on a freshly created cluster (2026-11-23), R9 first. R2 was then rerun on
the same deploy after a fix to its evidence line only (it listed the old pods while they were terminating). R2 and
R3 were rerun again after adding the cross-check against agent-service's own count (both PASS).

## Manual tests

- **A stuck run** ([`manual/stuck-writes.sh`](manual/stuck-writes.sh)): makes the database refuse the worker's status
  writes, so the run page shows "This run is stuck: setRunStatus keeps failing (attempt N) — …"; turning it off lets
  the run recover by itself. Instructions at the top of the script.
