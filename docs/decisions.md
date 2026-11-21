# Decisions

Newest first. Each: what we chose, what we rejected, and why.

## 2026-11-21 — Concurrency window: a counter inside the workflow
**Chose:** each run's workflow counts its running agents and starts the next one whenever the count is
below the window. A message to the running workflow changes the window.
**Rejected:** a child workflow per agent.
**Why:**
- The window belongs to one run, so it lives in that run's workflow.
- Child workflows separate each agent's history, but add moving parts we don't need at 6–10 agents. At hundreds of agents per run, we'd switch.

## 2026-11-21 — Backend language: TypeScript
**Chose:** TypeScript. **Rejected:** Go.
**Why:**
- I read TypeScript fluently, so I can review every line the agent writes.
- Temporal's TypeScript SDK sandboxes workflow code, blocking the non-deterministic calls that break crash recovery. Go has no such guard. *(Per the docs; not yet verified by a spike.)*
- One language across the stack, frontend included.
