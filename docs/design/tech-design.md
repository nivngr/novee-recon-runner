# Tech design

A user picks a domain, a number of recon agents and how many may run at once. The system runs the agents
under that limit, merges what they find, waits for a human to approve, and only then stores the results,
telling the truth about progress the whole way and surviving crashes along it.

This page is the short version. The picture is [`system-diagram.html`](system-diagram.html), the reasons and
rejected options are in [`decisions.md`](../decisions.md) (D1–D15), and every build detail is in
[`plan.md`](plan.md).

## The parts

| Part | What it does |
|---|---|
| **web** (Next.js) | The UI. Polls the API every second and forwards `/api/*` to it. No logic of its own. |
| **api** | Checks requests, saves runs, starts, signals and cancels workflows, and serves what the UI shows. |
| **worker** (2 copies) | Runs the workflow, which decides what happens next, and the activities, which call agent-service and Postgres. Has no web server. |
| **Temporal** (given) | Remembers every run's progress, so a crashed worker's work can resume elsewhere. |
| **Postgres** (given) | What the UI reads, the findings waiting for a decision, and the approved results. |
| **agent-service** (given) | The recon agents: start one, ask how it's doing, stop it. |

## A run, start to finish

1. **Submit.** The browser creates the run's id and sends it with the domain and numbers. The API saves the run and its agents as `STARTING` / `QUEUED`, then starts the workflow.
2. **Run the agents.** The workflow starts agents while fewer than *window* are running; whenever one ends, the next starts. The first agent starts alone, so a bad domain fails after a single attempt.
3. **Each agent.** Start it, then poll it every second until it ends. Its findings go straight into a Postgres staging table, never through Temporal.
4. **Aggregate.** When every agent has ended, one query merges the findings, keeping each subdomain once at its most severe risk, and records the counts per risk.
5. **Decide.** The run waits for a human. Approve copies the merged findings into the results table; reject copies nothing. Either way the staged findings are kept as raw agent output.
6. **Throughout,** every change is written to Postgres, and the UI shows exactly that.

## What makes it reliable

**Crash recovery.** Temporal records every decision the workflow makes. If a worker dies, the other one
replays that record and carries on; agents already started are reattached by their scan id, never started
again. *(R2 · D3)*

**Exactly once.** Every step is safe to repeat: agent starts carry an idempotency key, database rows have
unique constraints, and even the submit is keyed by the browser's id. *(R3 · D10, D12)*

**Small history.** Activities return only ids, statuses and counts; the bulk findings bypass Temporal
entirely. *(R4 · D4)*

**Failures.** Temporary errors are retried. An agent that crashed, couldn't be started, or stalled is
written off, and the run continues without it. A bad domain ends the run `REJECTED_INPUT`. *(R5 · D7)*

**Stalls.** An agent whose progress hasn't moved for 60 seconds, or that has run for 5 minutes, is stopped
and written off, so it can't hold a slot forever. *(R1, R5 · D7)*

**Cancellation.** Cancelling stops every agent already started, starts none of the queued ones, and only
then ends the run `CANCELLED`, even if the worker was down when the cancel arrived. *(R7 · D6)*

## What the user sees

**The truth, from Postgres.** The UI reads only what the backend has recorded, so it keeps working while
the workers are down, and it never shows a step before it has happened. *(R8 · D5)*

**Polling that stops.** The page asks every second while agents run, every 5 seconds while waiting for
approval, and not at all once the run has ended. *(R8 · D11)*

**Buttons that are only enabled when legal.** The API returns which actions are allowed right now; it also
refuses illegal ones, and the workflow checks again on arrival. *(R6, R8 · D8)*

**A changeable window.** Raising it starts more agents at once; lowering it only holds back new starts.
*(R1 · D2)*

## Delivery and checks

**One command.** `task up` typechecks and tests everything, builds every image from the same commit, loads
them into any k3s flavour, migrates the database, and deploys. *(R9 · D13, D14)*

**Proven, not claimed.** Each requirement has a repeatable proof script, the riskiest behaviours have
automated tests that block a bad deploy, and the UI flows are recorded on video. *(D15)*

## Requirements map

| Req | Handled by |
|---|---|
| R1 Window holds and resizes | A counter in the workflow, changed by a signal (D2) |
| R2 Survives a worker crash | Temporal's replay; heartbeats; reattach by scan id (D3) |
| R3 Recorded exactly once | Idempotency keys, unique constraints, a keyed submit (D10, D12) |
| R4 Bulk stays out of the workflow | Findings go to a staging table; activities return counts (D4) |
| R5 Failures classified | Retry policies, written-off agents, `REJECTED_INPUT` (D7) |
| R6 Human gate | Approve or reject signals; results stored only on approve (D4, D8) |
| R7 Cancellation stops agents | Built-in cancel, then a cleanup that stops agents (D6) |
| R8 Honest frontend | Read model in Postgres, polling that stops, allowed actions (D5, D8, D11) |
| R9 One-command deploy | `task up` and the manifests (D13, D14) |

## Statuses

`STARTING` → `RUNNING` → `AGGREGATING` → `AWAITING_APPROVAL` → `PERSISTING` → `COMPLETED`

Other endings: `REJECTED` (a human said no), `REJECTED_INPUT` (unsupported domain), `CANCELLED` (cleanup
ran), `FAILED` (anything else, including no agent completing). All are the brief's words except
`STARTING`, which covers the moment between submit and the workflow's first step.

## Assumptions

- "Persisted results" means the `discovered_domains` table, which only approve writes. Staged findings are raw agent output, kept for every run.
- A stalled agent is written off after 60 seconds without progress or 5 minutes in total; both are per-run settings.
- A run has at most 20 agents.
- No user accounts: the brief has none.
