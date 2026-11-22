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
into `discovered_domains`; reject or cancel deletes the staged rows. Duplicates keep the most severe risk:
risk is an ordered enum (`LOW < MEDIUM < HIGH < CRITICAL`), so that's simply `max(risk)`.
**Rejected:** re-fetching the results from agent-service at approval.
**Why:**
- Robust: survives an agent-service restart, and the human approves exactly what gets stored.
- Verifiable: the raw per-agent results let us check our dedup is correct (R2, R3 proofs).
- Raw material for agent evaluation: per-agent findings show which technique finds what, each agent's unique contribution, and where agents disagree on risk. (Noise in this simulator; real signal with real agents.)
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

## D8 — Messages into a run: signals, checked twice
**Chose:** approve, reject and change-window are Temporal signals. The API first checks the action is
legal in the run's current phase (from the read model, D5) and refuses with 409 if not. The workflow
checks again when the signal arrives, and the first decision wins.
**Rejected:** Temporal updates (a request with a validated reply).
**Why:**
- A signal is stored even with the worker down and applied when it returns; an update needs a live worker to answer *(per the docs)*.
- The API check gives the user a fast, clear "not now". The workflow check holds against races, since only it sees the real state.

## D9 — Database access: Prisma
**Chose:** Prisma 7 (pinned stable), with the approve statement as TypedSQL. **Rejected:** Drizzle.
**Why:**
- I know Prisma well, and it's fully typed, including the one hand-written SQL statement.
- Migrations are easy and safe to apply in the one-command bring-up.
- [Spike 04](../spikes/04-prisma/README.md) confirmed every critical write: idempotent staging, `max` over the risk enum, a retry-safe approve.

## D10 — Schema: the starter's tables, constrained
**Chose:** keep the starter's tables and columns, and add: `UNIQUE (assessment_id, agent_index)`,
`UNIQUE (assessment_id, domain)`, the `staged_discoveries` table (D4) tied to its agent row, ordered enums
for risk and statuses, forward-only status updates, all agent rows created at submit, and the worker
(pod) handling each agent.
**Rejected:** an append-only events table.
**Why:**
- The unique constraints make retried writes harmless (R3), and graders' queries on the starter's tables still work.
- Forward-only updates stop a late write from a stale worker reverting a status.
- Agent rows created at submit let the UI show queued agents from the first second (R8).
- Here Temporal's history covers each run's timeline; we'd add events when audit must outlive Temporal's retention.

## D11 — UI updates: polling with TanStack Query
**Chose:** the page polls the run every 1s while agents run and every 5s while awaiting approval, refreshes
immediately after the user's own action, and stops at any terminal status.
**Rejected:** push via server-sent events (WebSockets add two-way messaging we don't need).
**Why:**
- Progress changes every second anyway (each `waitAgent` poll writes it), so push would save little.
- Polling fits the read model (D5) with no extra plumbing or long-lived connections.
- The one real case for push, a long wait for approval, is handled by polling more slowly then.

## D12 — Run identity: a UUID from the browser, a submit safe to repeat
**Chose:** the browser generates the run's UUID and sends it with the submit. The API saves the rows with
"insert, or do nothing if it exists", and starts the workflow with id `assessment-<uuid>`, treating
"already started" as success. Same id, different parameters → 409. Agent keys are `<uuid>-agent-<n>`.
**Rejected:** the API generating the id, with a sweeper failing runs stuck in `STARTING`.
**Why:**
- A double click or a retried submit can't create two runs, and a half-finished submit is completed by retrying it.
- Only the retrier can keep the id stable across retries, and that's the browser.
- Temporal allows one running workflow per id, so starting twice is harmless.

## D13 — Our HTTP API: REST with shared zod contracts
**Chose:** a small REST API, request and response shapes as zod schemas in one package shared by the API
and the frontend, `allowedActions` returned with each run, and the browser reaching the API only through
Next.js. `task up` refuses to deploy unless the whole repo typechecks and its tests pass, and builds every
image from the same commit.
**Rejected:** tRPC; GraphQL.
**Why:**
- REST is driven by plain `curl`, which our proofs and the graders use. Shared zod still gives end-to-end types.
- One copy of the legality rules, on the backend: the UI enables buttons from `allowedActions`.
- A contract change that breaks either side stops the deploy, with no CI needed.

## D14 — Deployment: one `task up`
**Chose:** `task up` checks, builds every image from one commit (tagged with its git hash), loads them
using the detected k3s flavour, runs the schema as a one-off migrate Job, then deploys. The worker
proves liveness by touching a file that an `exec` probe checks, and runs as 2 replicas. `task open`
port-forwards the UI.
**Rejected:** supporting k3d only; migrating on API startup; a health endpoint in the worker; an Ingress.
**Why:**
- Graders bring their own cluster: flavour detection and port-forwarding work on any of them.
- A migrate Job is one explicit step that never races between replicas.
- The worker stays a non-HTTP process (R9), and a hung worker stops touching the file and gets restarted.
- With 2 replicas, a killed worker's agents move to the other within ~10s (R2).
