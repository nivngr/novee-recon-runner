# Tech design

How the system works and why. Each open question below gets settled in discussion, recorded in
[`decisions.md`](../decisions.md), and written up here.

**Stack:** TypeScript backend (API + worker), Next.js frontend, Temporal, Postgres, local k3s.
**Tooling:** k3d as the local k3s, Task (`Taskfile.yml`) as the task runner.

## The concurrency window (R1)

**In one sentence:** the workflow counts its running agents and starts the next one whenever the count is
below the window.

- **Each agent is a lane:** start it, wait until it ends, free its slot. Any ending frees the slot: completed, failed or stopped.
- **The loop:** start lanes while `running < window` and agents are queued; otherwise sleep until something changes (a lane ends, or the window changes).
- **Changing the window:** a message to the running workflow sets the new value. Raising it starts more agents at once. Lowering it only holds back new starts until `running` drops below it; nothing in flight is killed.
- **A slot is taken when we decide to start,** so retries of a failed start happen inside the slot and can't exceed the window.
- **Stalled agents:** an agent whose progress stops moving (60s), or that hits a time ceiling (5 min), is stopped at agent-service first, then its slot is freed, so a stalled agent never pushes us past the window (D7).
- **The first agent starts alone,** so a bad domain gets exactly one start attempt (R5).
- **No polling inside the workflow:** Temporal wakes it on each event (a message, or an agent ending). *(Verified in [spike 01](../../spikes/01-window/README.md).)*

## Agent steps (R2, R4)

**In one sentence:** each agent is three small activities, and none of them returns the discoveries.

| Activity | Does | Returns |
|---|---|---|
| `startAgent` | `POST /scans` with key `<runId>-agent-<n>`. A 503 is retried with backoff; a 422 is not. | the scan id |
| `waitAgent` | Polls `GET /scans/{id}` every ~1s and heartbeats, until the agent ends, stalls or hits its ceiling | status and discovered count |
| `stopAgent` | `POST /scans/{id}/stop`. Safe to repeat. | nothing |

- **The heartbeat is a lease:** if the worker dies, heartbeats stop, and within ~10s Temporal re-runs `waitAgent` on another worker. It polls the same scan id, so the agent is reattached, not restarted.
- **Stall detection (our assumption):** a stalled agent never errors, so `waitAgent` gives up when progress hasn't moved for 60s or the agent has run 5 min (per-run settings, D7). Neither resets after a crash: the ceiling uses agent-service's own start time, and the no-progress clock travels to the re-run in the heartbeat details *(per the docs; to verify)*. Then the lane calls `stopAgent`, marks the agent lost, and frees its slot.
- **Polling is forced:** agent-service has no callback. It's cheap here: polls inside an activity add nothing to the history (spike 01: 78 events for a whole run).

## Results before approval (R4, R6)

**In one sentence:** findings wait in a Postgres staging table, and only an approve turns them into results.

- **When an agent completes,** `waitAgent` writes its findings to `staged_discoveries` (run, agent number, subdomain, risk) and returns only the count. Safe to repeat: a re-run can't add duplicate rows.
- **Aggregate:** one SQL query over the staged rows gives unique subdomains, keeping the most severe risk when agents disagree. It returns a small summary (counts per risk) to the workflow. Order doesn't matter, so a replay can't change it.
- **Approve:** one SQL statement copies the deduplicated set into `discovered_domains`, the results table.
- **Reject or cancel:** deletes the run's staged rows, so nothing from it remains.
- **Approved runs keep their staged rows.** They're the raw material for agent evaluation (which technique finds what, each agent's unique contribution, risk disagreements), and a check: stored results must equal the distinct staged subdomains (R2, R3 proofs).
- **Assumption:** "persisted results" means `discovered_domains`. The staging rows of rejected or cancelled runs are deleted, so nothing from them remains.

## Reading progress (R2, R8)

**In one sentence:** the workflow publishes its state to Postgres as it changes, and the UI reads only Postgres.

- **Before the workflow exists:** the API inserts the run row as `STARTING`, then starts the workflow, so a read right after submit shows "starting", not an error.
- **Per agent:** `waitAgent` updates its agent's row on each poll (status, progress), about 1s fresh.
- **Per run:** the workflow records each phase change through a tiny activity, and only once it's true (e.g. writes "awaiting approval", then starts waiting).
- **While the worker is down:** reads keep working and the numbers freeze, honestly. When it's back, writes resume.
- **Safety net:** if Temporal says the workflow is closed but the database still says live (a bug, or killed by hand), the API shows `FAILED`. `describe` needs no worker.
- **Lag:** milliseconds behind the workflow, below the UI's 1–2s polling.
- **If a write fails:** progress writes are best-effort (logged, never retry the wait; the next poll writes again). Phase, staging and terminal writes are retried, with backoff capped at a few seconds, and the run waits for them, so nothing is announced before it's recorded.
- **If Postgres is down:** the API can't read either and the UI says so. A run can't finish without Postgres anyway (D4).

Verified in [spike 02](../../spikes/02-read-paths/README.md): a query hangs ~29s with no worker; heartbeat progress via `describe` is ~5s stale.

## Cancellation (R7)

**In one sentence:** the API cancels the workflow, and the workflow's cleanup stops every agent it started
before ending `CANCELLED`.

- **Trigger:** the API records "cancel requested" (the UI shows "cancelling"), then cancels the workflow. Temporal wakes it with a cancellation error and cancels its running `waitAgent` steps. The window loop ends, so no queued agent starts.
- **Cleanup can't be cancelled:** it waits for every lane, so an in-flight start finishes and we learn its scan id. Then it stops each started, unfinished agent, deletes the run's staged rows (D4), and writes `CANCELLED`.
- **Who stops the agents:** the worker, through `stopAgent`, run by the cleanup. A 404 means agent-service no longer knows the scan, so there's nothing to stop. Other failures are retried for a bounded time, then the agent is flagged "stop unconfirmed" and the run still ends `CANCELLED`.
- **Worker down at cancel:** Temporal stores the cancel, and the cleanup runs when a worker returns. Until then, agents keep running.
- **When Cancel is allowed:** running, aggregating, awaiting approval. Not once persisting has begun: that's one transaction that either completes or doesn't.
- **Pitfall:** every lane's error must be handled when the lane is created. An unhandled cancellation error fails the workflow step forever, leaving the run stuck live.

Verified in [spike 03](../../spikes/03-cancel/README.md).

## Errors and timeouts (R5)

**In one sentence:** retry what's temporary, write off a bad agent, and end the run only when it can't
produce anything worth reviewing.

| What goes wrong | What we do |
|---|---|
| Start → 503, 429, network error | Retried by Temporal (1s, doubling, capped at 10s) for up to 2 min, then the agent is lost |
| Start → 422 | No retry; the run ends `REJECTED_INPUT` (the first agent starts alone, so one attempt) |
| Start → 400 | No retry; the run ends `FAILED` (our bug) |
| Agent reports `FAILED` | Lost; the run continues |
| Poll → network error | `waitAgent` polls again in 1s (its own loop, not a Temporal retry) |
| Poll → 404 | Lost (agent-service forgot it) |
| Progress unchanged for 60s | Stalled: stopped, then lost |
| Running for 5 min | Ceiling: stopped, then lost |

- **Who retries:** the workflow declares a retry policy per activity, the activity only classifies (throws, or throws "do not retry"), and Temporal does the retrying. The workflow sees one result.
- **Timing values are per-run settings** with these defaults, so longer agents can be configured.
- **The run's end:** no agent completed → `FAILED`. Otherwise it aggregates whatever completed, and the UI shows how many were lost.
- **Normal endings:** `REJECTED_INPUT` and `REJECTED` finish the workflow successfully, carrying that outcome; Temporal shows "failed" only for real breakage.

## Messages into a run

**In one sentence:** user actions reach the workflow as signals, and each is checked for legality by the
UI, the API and the workflow.

| Phase | Approve / Reject | Change window | Cancel |
|---|---|---|---|
| Starting, running agents | no | yes | yes |
| Aggregating | no | no | yes |
| Awaiting approval | yes | no | yes |
| Persisting | no | no | no |
| Terminal | no | no | no |

- **Frontend:** buttons enabled only when the table allows it, and disabled while a request is in flight (R8).
- **API:** checks the table against the read model (D5) and refuses with 409 if not allowed. It records the request ("approval requested"), so the UI shows "approving…" until the backend reports `PERSISTING`, then `COMPLETED`.
- **Workflow:** checks again when the signal arrives and ignores what's illegal; the first decision wins. It is the final judge, since the API's view can be a moment behind (two tabs, approve racing cancel, signals sent straight to Temporal).
- **Worker down:** signals are stored and applied when a worker returns.
- **Cancel** uses Temporal's built-in cancel (D6), but follows the same table.

## Schema (R3)

**In one sentence:** the starter's tables keep their names and columns, and gain the constraints that make
every retried write harmless.

| Table | One row per | Key additions to the starter |
|---|---|---|
| `assessments` | run | `status` enum; `cancel_requested_at`, `decision` + `decision_requested_at`; stall timeout and ceiling settings; risk summary counts; `failure_reason` |
| `assessment_agents` | agent | **`UNIQUE (assessment_id, agent_index)`**; `status` enum; `progress`; `discovered_count`; `lost_reason`; `worker` (pod name) |
| `staged_discoveries` *(new)* | (run, agent, subdomain) | primary key on all three; foreign key `(assessment_id, agent_index)` → `assessment_agents`; deleted with its run |
| `discovered_domains` | (run, subdomain) | **`UNIQUE (assessment_id, domain)`**; `risk` as the ordered enum |

- **Enums:** risk `LOW < MEDIUM < HIGH < CRITICAL`, so "most severe" is `max(risk)`. Run status uses the brief's words: `STARTING`, `RUNNING`, `AGGREGATING`, `AWAITING_APPROVAL`, `PERSISTING`, then `COMPLETED`, `REJECTED`, `REJECTED_INPUT`, `CANCELLED`, `FAILED`. "Cancelling" and "approving" are shown from the request timestamps, not as statuses.
- **Every insert is "insert, or do nothing if it exists",** so a retried activity can't duplicate.
- **Every status update is conditional** ("set `COMPLETED` only if `RUNNING`"), so statuses only move forward, even if a stale worker writes late.
- **At submit,** the API creates the run row (`STARTING`) and all agent rows (`QUEUED`) in one transaction.
- **Database names are `snake_case`;** Prisma maps them to `camelCase` in code.

## UI updates (R8)

**In one sentence:** the run page polls the API with TanStack Query, and stops polling when the run ends.

- **Interval:** 1s while agents run (matching `waitAgent`'s 1s progress writes), 5s while awaiting approval (nothing changes until a person acts), and an immediate refresh after the user's own action.
- **Stops** at any terminal status, and when the page closes: `refetchInterval` returns `false`.
- **Right after submit:** the run and agent rows already exist (D10), so the first poll shows "starting, 0 of N, N queued".
- **Never optimistically terminal:** after Approve returns, the page shows "approving…" until a poll reports `COMPLETED`.
- **Buttons:** enabled per the legality table (D8), and disabled while their request is in flight.
- **When push would pay off:** long idle waits and many viewers. Here, slower polling while awaiting approval covers it.

## Run identity

**In one sentence:** one UUID per run, created by the browser, from which every other id is derived, so the
submit itself is safe to repeat.

- **Derived ids:** workflow `assessment-<uuid>`; agent idempotency keys `<uuid>-agent-<n>`. Stable across retries, crashes and replays (R2, R3).
- **Submit, step by step:** validate the UUID → in one transaction, insert the run (`STARTING`) and its agent rows (`QUEUED`), doing nothing if they exist → start the workflow; "already started" counts as success → reply with the id.
- **What a repeat does:** a double click, or a retry after a crash between the two steps, sends the same id. The save is a no-op, and the start either begins the missing workflow or finds it running.
- **Same id, different parameters:** 409, never the other run.
- **Temporal's "use existing" conflict policy** would return the running workflow instead of an error *(per the docs; check the SDK and server support it when building)*.

## Open questions

11. **Our HTTP API:** endpoints and their shapes.
12. **Deployment (R9):** the worker's liveness signal without HTTP, how the schema is applied in the one-command bring-up.
13. **How it's verified:** one row per requirement (its proof script, any automated test), and which test would catch a real regression.
