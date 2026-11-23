# apps/worker

## Changing workflow code (`src/workflows/`)

- **Run the replay test** (part of `task check`). If it fails, the change would break runs already in flight:
  rethink it, or (if the change is intended and no old runs need to survive it) re-record the fixture with
  `src/scripts/record-history.ts` against a real run, and say so in the report.
- Workflow code imports only `@temporalio/workflow`, `@novee/contracts`, and from `../activities` only types plus
  `types.ts` and `failure-types.ts` (neither imports a runtime module). Anything with I/O runs in an activity.

## Changing activities (`src/activities/`)

- Every activity must be safe to repeat: guard each write with the status it moves from (see `packages/db`),
  and call `failIfInjected(failFirstAttempts)` right *after* its side effect, so the R3 switch tests the retry.
- Activity classes keep their dependencies in `#private` fields: the worker registers the object's own
  properties as activities, and a `private` (TypeScript-only) field would be registered too.
- Inputs and outputs stay small (ids, counts, statuses), never findings lists: they're stored in the
  workflow's history (R4).
