# Spike 01: the concurrency window

**Question:** does the window design hold (sliding, resizable mid-run), and does the workflow really
wake only on events rather than polling?

**What it is:** the window decision in miniature, against the real agent-service and a local Temporal
dev server. A workflow counts running agents and waits on `condition(() => running < window)`. A
`setWindow` signal changes the window. Two activities: `startAgent` (Idempotency-Key, 503 retried, 422
not) and `waitAgent` (polls every 1s, heartbeats). `client.ts` plays the API.
Not covered: stall ceiling, first agent alone, cancellation, Postgres.

**Run (2026-11-21):** 6 agents on `acme.com`, window 2, raised to 3 after 15s; agents 8–20s;
agent-service default of two 503s per domain.

**Findings:**
- agent-service: `maxConcurrent: 3`, `totalStarted: 6`. Two at a time before the raise.
- The raise alone started a third agent: `WorkflowExecutionSignaled` at 51.488s, `startAgent`
  scheduled 56 ms later.
- Sliding: every `waitAgent` completion was followed ~20 ms later by the next `startAgent`.
- Workflow tasks appear only after events (signal, activity completion). No timers or polling in
  the history. **Verified.**
- The 503 retries show as `attempt=2` on a single event: retries and heartbeats add no history
  events. The whole run is 78 events.
- We notice an agent ended up to ~1.6s after agent-service does (1s poll). It errs safe: a slot frees
  late, never early.

**Reproduce:** Temporal dev server on `localhost:7233`, agent-service on `localhost:18080`, then
`npx tsx src/worker.ts` and, in another terminal, `npx tsx src/client.ts`. Inspect with
`temporal workflow show -w <workflowId>` or the Web UI on `localhost:8233`.
