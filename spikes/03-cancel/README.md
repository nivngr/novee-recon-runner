# Spike 03: cancellation and cleanup

**Question:** does Temporal's built-in cancellation stop running agents, let in-flight starts finish so
their agents can be stopped too, and still work when the worker is dead at the moment of cancel?

**What it is:** spike 01's window plus the cancellation design (D6). Starts run in a non-cancellable
scope; on cancel, a non-cancellable cleanup collects every lane, then stops each started, unfinished
agent. `ops.ts` starts, cancels and describes runs. Agents 60–80s, so "stopped" can't be "finished".

**Results (final run):**

| Scenario | Result |
|---|---|
| S1: cancel with 2 agents running | Cancel accepted in 14 ms; both `STOPPED` ~35 ms later; workflow `CANCELLED`; `totalStarted` 2 |
| S2: cancel while both starts retry 503s | Both starts completed after the cancel, then were stopped within 35 ms; `CANCELLED` |
| S3: worker dead at cancel | Cancel accepted in 12 ms without a worker; agents kept running for the 10s gap; worker restarted → stopped in 2s → `CANCELLED` |

**What the first runs caught** (see the AI log):
- All three runs stuck `RUNNING`: an unheard lane cancellation error ("unhandled rejection") fails the
  workflow task, and Temporal retries it forever. Fix: handle each lane's error when it's created.
- `stopAgent` retried a 404 forever (agent-service had forgotten the scan). Fix: 404 means nothing to stop.
- A false pass: the kill hit `npx`, not the Node worker, so "worker dead" wasn't. Fix: kill by script path.

**Reproduce:** Temporal on `localhost:7233`, agent-service on `localhost:18080` (agents 60–80s). Run
`npx tsx src/worker.ts`, then `npx tsx src/ops.ts start acme.com` and `npx tsx src/ops.ts cancel <id>`;
check `GET /admin/scans`. For S3, `pkill -9 -f src/worker.ts` before the cancel.
