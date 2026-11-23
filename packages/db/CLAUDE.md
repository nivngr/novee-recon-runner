# packages/db

## Changing `prisma/schema.prisma`

- **Change the schema, let Prisma write the SQL:** `task db:migration NAME=<what_changed>` (needs Docker;
  Prisma diffs against a scratch Postgres). Never hand-write a migration as a shortcut, and never edit a
  migration that has been committed: add a new one.
- **If Prisma can't express it, stop and tell the user before writing any SQL by hand.** The one agreed
  exception so far: value ranges (`CHECK (agent_count BETWEEN 1 AND 20)`, …), appended to the generated
  migration; keep plan §2 and the API's validation limits saying the same thing.
- An enum change goes in `packages/contracts/src/vocabulary.ts` too, in the same order (enum order is sort
  order: `max(risk)` = most severe). `enum-parity.ts` fails the typecheck until both match.
- Run `task test:db`, then update plan §2 if the tables changed.

## Writing queries

- Status changes are conditional (`WHERE status IN (allowed from)`), forward only; 0 rows = "already moved
  on", not an error. Inserts are insert-or-nothing (`skipDuplicates` / `ON CONFLICT DO NOTHING`).
- Where a write moves a status *and* adds rows, move the status first in the same transaction and add rows
  only if it moved (see `approve`, `completeAgent`).
- Never delete data. Staged findings are kept for every run (D4).
- No TypedSQL: it needs a live database at generate time, and image builds have none (A2). Hand-written SQL
  goes through `$executeRaw` with bound parameters.
