# apps/worker

## Changing workflow code (`src/workflows/`)

- **Run the replay test** (part of `task check`). If it fails, the change would break runs already in flight (A4):
  Temporal finishes old runs with the new code.
- **The workflow's input is a public API whose old callers can't be updated.** Change it additively only (new
  optional fields). If a breaking change is unavoidable, the new code accepts the old shape too (a small converter
  at the workflow's entry, plus a replay fixture recorded with the old shape), and both are **temporary**:
- **Retire compatibility code as soon as it's unused:** once no run started before the change is still open
  (`temporal workflow count --query 'ExecutionStatus="Running" AND StartTime < "<deploy time>"'` returns 0),
  delete the converter and its fixture in the same change. Old shapes must not accumulate.
- In production, prefer Temporal's Worker Versioning (old runs stay on the old workers until they finish) over
  converters; see `NOTES.md`.
- Workflow code imports only `@temporalio/workflow`, `@novee/contracts`, and from `../activities` only types plus
  `types.ts` and `failure-types.ts` (neither imports a runtime module). Anything with I/O runs in an activity.

## Changing activities (`src/activities/`)

- Every activity must be safe to repeat: guard each write with the status it moves from (see `packages/db`),
  and call `failIfInjected(failFirstAttempts)` right *after* its side effect, so the R3 switch tests the retry.
- Activity classes keep their dependencies in `#private` fields: the worker registers the object's own
  properties as activities, and a `private` (TypeScript-only) field would be registered too.
- Inputs and outputs stay small (ids, counts, statuses), never findings lists: they're stored in the
  workflow's history (R4).
