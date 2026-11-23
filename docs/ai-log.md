# AI log

Where the coding agent got it wrong, and how we noticed. In the order it happened. Shown: catches that would
have broken a requirement or shipped broken. Smaller ones are kept as unnumbered comments in this file.

<!-- Below the bar (kept for the record):
## Design — padded "rejected alternatives"
**File:** `docs/decisions.md` (D2, D4 drafts)
**Wrong behaviour:** the agent listed alternatives the brief forbids or nobody would build (fan-out, cron,
agent-service's own cap; Redis for staging), making the comparison look broader than it was.
**How we noticed:** I asked for one genuine rejected alternative; most of the list didn't survive the question.
**Fix:** each decision now names only genuine alternatives (child workflows for D2, re-fetching for D4).
-->

## A1 — R7 — cancelled runs stuck live
**File:** `spikes/03-cancel/src/workflows.ts`
**Wrong behaviour:** on cancel, the running lanes' cancellation errors went unhandled. The TypeScript SDK
treats that as a broken workflow step and retries it forever, so cleanup never ran: agents not stopped,
run stuck `RUNNING`.
**How we noticed:** spike 03, all three scenarios stayed `RUNNING`; the worker log said
"Unhandled Promise rejection: Activity cancelled".
**Fix:** handle each lane's error when it's created; cleanup first collects every lane.

## A2 — R7 — stop retried forever on an unknown scan
**File:** `spikes/03-cancel/src/activities.ts`
**Wrong behaviour:** `stopAgent` treated agent-service's 404 (scan unknown, e.g. after a restart) as a
retryable failure, so cleanup could never finish.
**How we noticed:** stale workflows from the broken run retried `stop failed: HTTP 404` in the worker log.
**Fix:** 404 means there is nothing to stop.

## A3 — Spike 03 — a false pass
**File:** spike 03's run script
**Wrong behaviour:** "kill the worker" killed only the `npx` wrapper; the Node worker kept running, so the
worker-down scenario passed without testing anything.
**How we noticed:** agents were stopped while the worker was supposedly dead, which was too good; `ps`
showed workers alive.
**Fix:** kill by script path and confirm no worker is alive before the step.

<!-- Below the bar (kept for the record):
## R5 — naive stall detection first
**File:** `docs/decisions.md` (D7 draft)
**Wrong behaviour:** the agent proposed only a fixed 5-min ceiling for stalled agents, holding a window
slot for minutes, though a no-progress timeout (stalls freeze progress) catches them in about one.
**How we noticed:** I asked for genuine alternatives to each choice; the better option surfaced there.
**Fix:** both: a 60s no-progress timeout, with the 5-min ceiling as a backstop.
-->

## A4 — R9 — the plan picked Alpine images the worker can't run on
**File:** `docs/design/plan.md` (§8, images)
**Wrong behaviour:** the plan specified Node Alpine images for every service. Temporal's worker loads a native
library, and the SDK ships it only for glibc Linux; Alpine uses musl, so the worker would fail at startup.
**How we noticed:** before writing the first Dockerfile, we listed the binaries in `@temporalio/core-bridge`:
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, no musl.
**Fix:** all Node images use `node:22.23.5-bookworm-slim` (Debian, glibc).

<!-- Below the bar (kept for the record):
## R9 — `task up` never returned
**File:** `Taskfile.yml` (the last step of `up`)
**Wrong behaviour:** the closing message was `echo "… Open the UI with `task open` …"`. The shell runs anything
in backticks, so `task up` actually started the port-forward and blocked forever: a grader's one-command
bring-up would hang at the very end.
**How we noticed:** the first `task up` on a fresh cluster deployed everything but never exited; its log
ended with `task: [open] … port-forward`.
**Fix:** plain quotes in the message.
-->

## A5 — R3 — the plan's TypedSQL couldn't be built in an image
**File:** `docs/design/plan.md` §2 (`approve`), D9
**Wrong behaviour:** the plan wrote the approve statement as TypedSQL. `prisma generate --sql` connects to a
database to type the query, and our image builds have none, so the api and worker images could never build.
Spike 04 hid it: it always generated against a running Postgres.
**How we noticed:** before writing M2, ran the spike's generate against an unreachable host: `P1001 Can't reach
database server`; plain `prisma generate` worked.
**Fix:** a parameterised `$executeRaw` for approve (it returns no rows), `groupBy` for aggregate.

## A6 — Tests — tests ran against a stale build
**File:** `packages/*/package.json` exports (M1), `vitest.config.ts`
**Wrong behaviour:** packages give types from `src/` but runtime code from `dist/`. Vitest followed the runtime
path and loaded M1's old `dist/` of `@novee/contracts`, which had no legality table, while the typecheck
(reading `src/`) passed. A test could pass or fail against code that no longer exists.
**How we noticed:** 2 of 13 database tests failed with `Cannot read properties of undefined (reading 'approve')`
on code that typechecked.
**Fix:** both Vitest configs alias the workspace packages to their source.

<!-- Below the bar (kept for the record):
## D1 — "the sandbox blocks non-deterministic calls"
**File:** `docs/decisions.md` D1
**Wrong behaviour:** D1 said the workflow sandbox *blocks* non-deterministic calls. It doesn't block
`Math.random()` or `Date.now()`: it replaces them with replay-safe versions (seeded per run; clock frozen per
workflow task). Only I/O is rejected. The guarantee holds; the description of it was wrong.
**How we noticed:** spike 05 called both inside a workflow: they returned values instead of throwing, and all
four runs replayed cleanly.
**Fix:** D1 reworded from the spike's results.
-->

## A7 — R6 — an approve could be dropped
**File:** `apps/worker/src/workflows/recon.ts` (`moveTo`)
**Wrong behaviour:** the first version wrote the status to the database, then updated the workflow's own
phase. The API allows approve once the *row* says `AWAITING_APPROVAL`, so an approve signal could arrive while
the workflow still thought it was `AGGREGATING`; the handler would ignore it, and the run would wait forever.
**How we noticed:** reviewing the workflow before its first run.
**Fix:** the phase moves first, then the row.

<!-- Below the bar (kept for the record):
## Worker — dependencies registered as activities
**File:** `apps/worker/src/activities/*.ts`, `main.ts`
**Wrong behaviour:** activity classes held their dependencies in TypeScript `private` fields and were
registered with `{ ...agentActivities }`. `private` only exists at compile time, so the spread would have
registered the HTTP client and database layer as "activities".
**How we noticed:** reviewing `main.ts` before the first run.
**Fix:** JavaScript `#private` fields, which a spread doesn't copy (checked: only the methods come through).
-->

<!-- Below the bar (kept for the record):
## Replay fixture — the developer's machine in a committed file
**File:** `apps/worker/src/workflows/fixtures/recon-history.json`
**Wrong behaviour:** the recorded history carried the worker identity (`pid@<hostname>`) and stack traces with
the home-directory path; it would have been committed with the submission.
**How we noticed:** inspecting the largest history events while checking R4 payload sizes.
**Fix:** the recorder replaces the hostname and home path before writing.
-->

<!-- Below the bar (kept for the record):
## Replay test — the fixture was in the wrong format
**File:** `apps/worker/src/scripts/record-history.ts`
**Wrong behaviour:** the recorder wrote the history with `JSON.stringify`, the protobuf *object* form; the
replayer reads protobuf's canonical JSON.
**How we noticed:** the replay test failed: `expected timestamp string: {"seconds":…}`.
**Fix:** `historyToJSON` / `historyFromJSON` from `@temporalio/common/proto-utils`.
-->

## A8 — R6 — the Approve button did nothing
**File:** `apps/web/app/api/[...path]/route.ts`, `apps/api/src/http/routes.ts`
**Wrong behaviour:** the web app's proxy labelled every POST as JSON, including approve, which has no body.
Fastify refused it with its own 400, so the decision never reached our code and the run waited forever. That
400 also wasn't in our error shape, so the browser read it as a contract mismatch.
**How we noticed:** the Playwright R8 run timed out on "Awaiting approval" after the click; the API log showed
`FST_ERR_CTP_EMPTY_JSON_BODY`.
**Fix:** the proxy sends a content type only with a body; the API answers its framework errors in the contract
shape too (error and not-found handlers, an `internal` code), with tests for both.

## A9 — R9 — the image cleanup deleted the image it had just loaded
**File:** `Taskfile.yml` (`prune-images`, the fix for the image pile-up below)
**Wrong behaviour:** to drop old builds from the node it ran `crictl rmi <old tag>`. When a build didn't change
an image (here `migrate`), the new and old tags point at the same image, and `crictl rmi` deletes the image
itself, every tag included. The next step's Job then couldn't start (`ImagePullBackOff`) and `task up` failed.
Local `docker rmi` only removes the tag, so checking it locally looked fine.
**How we noticed:** the next `task up` timed out waiting for the migrate Job; the node listed every current
image except `migrate`.
**Fix:** `ctr images rm`, which removes only the named reference.

## A10 — R2 — new code broke runs that had started under the old code
**File:** the workflow's input (`packages/contracts/src/workflow.ts`, `apps/worker/src/workflows/`)
**Wrong behaviour:** the agent changed the shape of the data a run starts with. Two runs that started before the change
were still waiting for approval. Temporal finishes old runs with the *new* code, and the new code couldn't read
their old data, so they got stuck on "approving…". The agent had assumed no old runs would be affected, and
replaced the one test that would have caught it.
**How we noticed:** I was testing by hand in the UI, approved one of those runs, and it never finished.
**Fix:** the new code accepted both shapes until those two runs had finished, then the extra code was deleted.
A rule now says compatibility code is temporary and removed once no old run is open.
**Better in production:** keep old runs on the old code until they finish (Temporal's Worker Versioning), and only
ever add to a workflow's input, never reshape it.

<!-- Below the bar (kept for the record):
## R9 — image builds piled up until the node evicted the stack
**File:** `Taskfile.yml` (`load`)
**Wrong behaviour:** each `task up` after an edit imported a new set of image tags and never removed old ones.
After a day of deploys the Docker disk hit 83%; the node reported DiskPressure, evicted every pod and
garbage-collected our images, which then couldn't be pulled (`ImagePullBackOff`). A grader deploying once
wouldn't hit it.
**How we noticed:** `task up` failed after 694s with every pod Pending; node events showed the image GC.
**Fix:** `task up` prunes our older tags after loading (local Docker and the k3d node).
-->

<!--
## A<n> — <requirement or spike> — <one-line summary>
**File:** …
**Wrong behaviour:** …
**How we noticed:** …
**Fix:** …
-->
