# packages/contracts

The shared vocabulary and API shapes, imported by `apps/api`, `apps/web`, `apps/worker` (including the
workflow) and `packages/db`.

- **A change here is a change to every consumer:** update them in the same change, then `task check`.
  Statuses and risk levels are also database enums: change them through `packages/db` (see its CLAUDE.md).
- **Keep it pure:** TypeScript and zod only, no Node APIs, no I/O, no other dependencies. It runs in the
  browser and inside Temporal's deterministic workflow sandbox.
- **Don't reorder `RISK_LEVELS`:** the order is severity, and it matches the database enum's sort order.
