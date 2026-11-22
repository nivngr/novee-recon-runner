# Decisions

In the order we made them. Each: what we chose, what we rejected, and why.

## D1 — Backend language: TypeScript
**Chose:** TypeScript. **Rejected:** Go.
**Why:**
- I read TypeScript fluently, so I can review every line the agent writes.
- Temporal's TypeScript SDK sandboxes workflow code, blocking the non-deterministic calls that break crash recovery. Go has no such guard. *(Per the docs; not yet verified by a spike.)*
- One language across the stack, frontend included.

## D2 — Concurrency window: a counter inside the workflow
**Chose:** each run's workflow counts its running agents and starts the next one whenever the count is
below the window. A message to the running workflow changes the window.
**Rejected:** a child workflow per agent.
**Why:**
- The window belongs to one run, so it lives in that run's workflow.
- Child workflows separate each agent's history, but add moving parts we don't need at 6–10 agents. At hundreds of agents per run, we'd switch.

## D3 — Agent steps: start, wait, stop
**Chose:** three activities per agent: `startAgent` (returns the scan id), `waitAgent` (polls every ~1s
and heartbeats; returns status and count), `stopAgent`.
**Rejected:** one combined start-and-wait step; the workflow polling with timers.
**Why:**
- The scan id reaches the workflow right after the start, so a running agent can always be stopped.
- Polling inside an activity keeps the history small, and its heartbeat detects a dead worker.
- agent-service has no callback, so polling is forced. With one, async activity completion would replace it.

## D4 — Results before approval: a staging table in Postgres
**Chose:** each completed agent's findings go to `staged_discoveries`. Approve copies the deduplicated set
into `discovered_domains`; reject or cancel deletes the staged rows. Duplicates keep the most severe risk.
**Rejected:** re-fetching the results from agent-service at approval.
**Why:**
- Robust: survives an agent-service restart, and the human approves exactly what gets stored.
- Verifiable: the raw per-agent results let us check our dedup is correct (R2, R3 proofs).
- In production, visibility into raw agent results (e.g. how techniques compare) for debugging and evaluation.
- Assumption: "persisted results" means `discovered_domains`. Staged rows of rejected runs are deleted.
