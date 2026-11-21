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

## Open questions

2. **Agent steps (R4):** what each step does (start, poll, stop) and what it returns.
3. **Results before approval (R4, R6):** where they live until a human decides.
4. **Reading progress (R2, R8):** where the UI reads from, including while the worker is down.
5. **Cancellation (R7):** who stops the agents, and what if that call fails.
6. **Errors and timeouts (R5):** what is retried, what stops the run, how long we wait.
7. **Messages into a running run:** how approve, reject and change-window reach it.
8. **Schema (R3):** constraints, the risk rule, recording which worker owns an agent.
9. **UI updates (R8):** polling or streaming, and the moment right after submit.
