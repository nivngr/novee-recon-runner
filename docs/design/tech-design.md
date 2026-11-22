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
- **Stalled agents:** every agent has a time ceiling. At the ceiling we stop it at agent-service first, then free the slot, so a stalled agent never pushes us past the window.
- **The first agent starts alone,** so a bad domain gets exactly one start attempt (R5).
- **No polling inside the workflow:** Temporal wakes it on each event (a message, or an agent ending). *(Verified in [spike 01](../../spikes/01-window/README.md).)*

## Agent steps (R2, R4)

**In one sentence:** each agent is three small activities, and none of them returns the discoveries.

| Activity | Does | Returns |
|---|---|---|
| `startAgent` | `POST /scans` with key `<runId>-agent-<n>`. A 503 is retried with backoff; a 422 is not. | the scan id |
| `waitAgent` | Polls `GET /scans/{id}` every ~1s and heartbeats, until the agent ends or hits its ceiling | status and discovered count |
| `stopAgent` | `POST /scans/{id}/stop`. Safe to repeat. | nothing |

- **The heartbeat is a lease:** if the worker dies, heartbeats stop, and within ~10s Temporal re-runs `waitAgent` on another worker. It polls the same scan id, so the agent is reattached, not restarted.
- **Time ceiling (our assumption):** a stalled agent never errors, so every agent gets a maximum run time, a per-run setting. It is measured from the agent's own start time, so a re-run after a crash doesn't reset it. At the ceiling, the lane calls `stopAgent`, marks the agent lost, then frees its slot.
- **Polling is forced:** agent-service has no callback. It's cheap here: polls inside an activity add nothing to the history (spike 01: 78 events for a whole run).

## Results before approval (R4, R6)

**In one sentence:** findings wait in a Postgres staging table, and only an approve turns them into results.

- **When an agent completes,** `waitAgent` writes its findings to `staged_discoveries` (run, agent number, subdomain, risk) and returns only the count. Safe to repeat: a re-run can't add duplicate rows.
- **Aggregate:** one SQL query over the staged rows gives unique subdomains, keeping the most severe risk when agents disagree. It returns a small summary (counts per risk) to the workflow. Order doesn't matter, so a replay can't change it.
- **Approve:** one SQL statement copies the deduplicated set into `discovered_domains`, the results table.
- **Reject or cancel:** deletes the run's staged rows, so nothing from it remains.
- **Approved runs keep their staged rows** as per-agent provenance, and as a check: stored results must equal the distinct staged subdomains (R2, R3 proofs).
- **Assumption:** "persisted results" means `discovered_domains`. The staging rows of rejected or cancelled runs are deleted, so nothing from them remains.

## Open questions

4. **Reading progress (R2, R8):** where the UI reads from, including while the worker is down.
5. **Cancellation (R7):** who stops the agents, and what if that call fails.
6. **Errors and timeouts (R5):** what is retried, what stops the run, how long we wait.
7. **Messages into a running run:** how approve, reject and change-window reach it.
8. **Schema (R3):** constraints, the staging table, recording which worker owns an agent.
9. **UI updates (R8):** polling or streaming, and the moment right after submit.
10. **Run identity:** what the run id is and who creates it (API, database or workflow); the idempotency keys depend on it.
11. **Our HTTP API:** endpoints and their shapes.
12. **Deployment (R9):** the worker's liveness signal without HTTP, how the schema is applied in the one-command bring-up.
13. **Testing:** which automated test would catch a real regression.
