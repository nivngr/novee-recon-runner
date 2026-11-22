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

## D5 — Reading progress: a Postgres read model
**Chose:** the workflow publishes its state to Postgres as it changes (via activities), and the UI reads
only Postgres. The workflow stays the source of truth; the database is its published copy.
**Rejected:** querying the workflow directly; a hybrid (query first, database when the worker is down).
**Why:**
- Reads keep working while the worker is down. A query hangs ~29s, then fails ([spike 02](../spikes/02-read-paths/README.md)).
- Per-agent progress is fresher: written on each poll (~1s). Heartbeat progress via Temporal is throttled (~5s old).
- The hybrid adds a query timeout, two read paths, and can show a status going backwards at the switch.
- Cost: every step now writes to Postgres. It was already required (D4); progress writes are best-effort.

## D6 — Cancellation: Temporal's built-in cancel, then cleanup
**Chose:** the API cancels the workflow. The workflow catches it and runs a cleanup that can't itself be
cancelled: let in-flight starts finish, stop every started agent, delete staged rows, write `CANCELLED`.
A stop is retried for a bounded time, then the agent is flagged "stop unconfirmed".
**Rejected:** a custom "cancel" message handled like approve.
**Why:**
- Built-in cancel also cancels the running `waitAgent` steps; a custom message means rebuilding that.
- Temporal stores the cancel, so it works with the worker down; cleanup runs when one returns ([spike 03](../spikes/03-cancel/README.md)).
- Retrying a stop forever could leave the run stuck live, which R7 forbids.

## D7 — Errors and timeouts
**Chose:** activities classify errors and Temporal retries by policy: 503, 429 and network errors with
capped backoff; a 422 ends the run `REJECTED_INPUT`, a 400 ends it `FAILED`. An agent is written off as
lost when it reports `FAILED`, its start fails for 2 min, its poll gets a 404, its progress hasn't moved
for 60s, or it reaches a 5-min ceiling (stalled agents are stopped first). If no agent completed, the run
ends `FAILED`. `REJECTED_INPUT` and `REJECTED` end the workflow normally.
**Rejected:** a single fixed time ceiling; failing the whole run when one start never succeeds.
**Why:**
- One bad agent doesn't sink the run (R5). The run fails only when there's nothing to review.
- The no-progress timeout catches a stall in about a minute without punishing slow agents; the ceiling backs it up.
- "Failed" in Temporal's UI stays reserved for real breakage.
