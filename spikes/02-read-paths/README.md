# Spike 02: read paths while the worker is down

**Question:** can the API read a run's state from the workflow (a Temporal query) while the worker is
dead, and how fresh is per-agent progress read from heartbeats via `describe`?

**What it is:** spike 01's workflow plus a `state` query. `start.ts` starts a run; `probe.ts` queries the
workflow and calls `describe`, printing timings and each running `waitAgent`'s last heartbeat.

**Run (agents 40–60s):** probe with the worker up, after `kill -9` of the worker, and after restarting it.

| Moment | Query | Describe | Heartbeat progress via describe |
|---|---|---|---|
| Worker up | OK, 25 ms | OK, 23 ms | 0.17, 5s old |
| Worker killed | **failed after 29 s** | OK, 37 ms, `RUNNING` | 0.37, 33s old (frozen) |
| Worker restarted (ready in 2s) | OK, 18 ms, correct state | OK, 12 ms | fresh |

**Findings:**
- A query needs a worker. With none, it hangs ~29s, then fails. A query-based UI is blind during a crash.
- Once a worker is back, queries are instant and correct (it replays the history).
- `describe` is answered by the server alone, so it works with no worker.
- Heartbeat progress reaches the server throttled: 5s old even with a healthy worker.

**Led to:** D5, read progress from a Postgres read model.

**Reproduce:** Temporal on `localhost:7233`, agent-service on `localhost:18080` (agents 40–60s). Then
`npx tsx src/worker.ts &`, `ID=$(npx tsx src/start.ts)`, `npx tsx src/probe.ts $ID up`; kill the worker
with `kill -9`, probe again; restart it, probe again.
