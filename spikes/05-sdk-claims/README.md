# Spike 05: the Temporal claims taken from the docs

**Question:** four design points rested on Temporal's docs only (D1, D7, D8, D12). Do they hold?

**What it is:** `src/main.ts` runs one tiny workflow per claim against the local Temporal server (1.31.2) with
SDK 1.26.0, worker in-process. `forbidden.ts` is a workflow that imports `node:fs`.

**Results:**
- **D1, corrected:** the sandbox doesn't *block* `Math.random()` / `Date.now()`, it *replaces* them.
  `Math.random()` is seeded per run: 4 runs that branch on it all replayed with no non-determinism error.
  `Date.now()` is frozen within a workflow task (unchanged across a busy loop). I/O is blocked: `fetch` is
  `undefined`, and bundling a workflow that imports `node:fs` fails at build time.
- **D7, confirmed:** after attempt 1 heartbeated `{lastProgress: 0.4, lastChangeAt: 1234}` and went silent,
  attempt 2 received exactly that in `info.heartbeatDetails` (~5s later: 3s heartbeat timeout + 1s retry).
- **D8, confirmed:** a signal sent while no worker ran was applied once a worker started; an update sent with
  no worker got no answer within 5s.
- **D12, confirmed:** a second start with `workflowIdConflictPolicy: 'USE_EXISTING'` returns the same run;
  the default policy throws `WorkflowExecutionAlreadyStartedError`.

**Reproduce:** Temporal on `localhost:7233`, then `npm i && npx tsx src/main.ts`.
