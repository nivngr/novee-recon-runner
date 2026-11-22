# AI log

Where the coding agent got it wrong, and how we noticed. In the order it happened.

## A1 — Design — padded "rejected alternatives" *(optional: decide later if it fits)*
**File:** `docs/decisions.md` (D2, D4 drafts)
**Wrong behaviour:** the agent listed alternatives the brief forbids or nobody would build (fan-out, cron,
agent-service's own cap; Redis for staging), making the comparison look broader than it was.
**How we noticed:** I asked for one genuine rejected alternative; most of the list didn't survive the question.
**Fix:** each decision now names only genuine alternatives (child workflows for D2, re-fetching for D4).

## A2 — R7 — cancelled runs stuck live
**File:** `spikes/03-cancel/src/workflows.ts`
**Wrong behaviour:** on cancel, the running lanes' cancellation errors went unhandled. The TypeScript SDK
treats that as a broken workflow step and retries it forever, so cleanup never ran: agents not stopped,
run stuck `RUNNING`.
**How we noticed:** spike 03, all three scenarios stayed `RUNNING`; the worker log said
"Unhandled Promise rejection: Activity cancelled".
**Fix:** handle each lane's error when it's created; cleanup first collects every lane.

## A3 — R7 — stop retried forever on an unknown scan
**File:** `spikes/03-cancel/src/activities.ts`
**Wrong behaviour:** `stopAgent` treated agent-service's 404 (scan unknown, e.g. after a restart) as a
retryable failure, so cleanup could never finish.
**How we noticed:** stale workflows from the broken run retried `stop failed: HTTP 404` in the worker log.
**Fix:** 404 means there is nothing to stop.

## A4 — Spike 03 — a false pass
**File:** spike 03's run script
**Wrong behaviour:** "kill the worker" killed only the `npx` wrapper; the Node worker kept running, so the
worker-down scenario passed without testing anything.
**How we noticed:** agents were stopped while the worker was supposedly dead, which was too good; `ps`
showed workers alive.
**Fix:** kill by script path and confirm no worker is alive before the step.

<!--
## A<n> — <requirement or spike> — <one-line summary>
**File:** …
**Wrong behaviour:** …
**How we noticed:** …
**Fix:** …
-->
