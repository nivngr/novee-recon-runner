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

## A5 — R5 — naive stall detection first *(optional: decide later if it fits)*
**File:** `docs/decisions.md` (D7 draft)
**Wrong behaviour:** the agent proposed only a fixed 5-min ceiling for stalled agents, holding a window
slot for minutes, though a no-progress timeout (stalls freeze progress) catches them in about one.
**How we noticed:** I asked for genuine alternatives to each choice; the better option surfaced there.
**Fix:** both: a 60s no-progress timeout, with the 5-min ceiling as a backstop.

## A6 — R9 — the plan picked Alpine images the worker can't run on
**File:** `docs/design/plan.md` (§8, images)
**Wrong behaviour:** the plan specified Node Alpine images for every service. Temporal's worker loads a native
library, and the SDK ships it only for glibc Linux; Alpine uses musl, so the worker would fail at startup.
**How we noticed:** before writing the first Dockerfile, we listed the binaries in `@temporalio/core-bridge`:
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, no musl.
**Fix:** all Node images use `node:22.23.5-bookworm-slim` (Debian, glibc).

## A7 — R9 — `task up` never returned
**File:** `Taskfile.yml` (the last step of `up`)
**Wrong behaviour:** the closing message was `echo "… Open the UI with `task open` …"`. The shell runs anything
in backticks, so `task up` actually started the port-forward and blocked forever: a grader's one-command
bring-up would hang at the very end.
**How we noticed:** the first `task up` on a fresh cluster deployed everything but never exited; its log
ended with `task: [open] … port-forward`.
**Fix:** plain quotes in the message.

## A8 — R3 — the plan's TypedSQL couldn't be built in an image
**File:** `docs/design/plan.md` §2 (`approve`), D9
**Wrong behaviour:** the plan wrote the approve statement as TypedSQL. `prisma generate --sql` connects to a
database to type the query, and our image builds have none, so the api and worker images could never build.
Spike 04 hid it: it always generated against a running Postgres.
**How we noticed:** before writing M2, ran the spike's generate against an unreachable host: `P1001 Can't reach
database server`; plain `prisma generate` worked.
**Fix:** a parameterised `$executeRaw` for approve (it returns no rows), `groupBy` for aggregate.

## A9 — Tests — tests ran against a stale build
**File:** `packages/*/package.json` exports (M1), `vitest.config.ts`
**Wrong behaviour:** packages give types from `src/` but runtime code from `dist/`. Vitest followed the runtime
path and loaded M1's old `dist/` of `@novee/contracts`, which had no legality table, while the typecheck
(reading `src/`) passed. A test could pass or fail against code that no longer exists.
**How we noticed:** 2 of 13 database tests failed with `Cannot read properties of undefined (reading 'approve')`
on code that typechecked.
**Fix:** both Vitest configs alias the workspace packages to their source.

<!--
## A<n> — <requirement or spike> — <one-line summary>
**File:** …
**Wrong behaviour:** …
**How we noticed:** …
**Fix:** …
-->
