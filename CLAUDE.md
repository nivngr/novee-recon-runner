# CLAUDE.md

Novee take-home: a Temporal-orchestrated recon-agent runner (brief: `brief/README.md`, local only and git-ignored; starter kit: `starter/`).
The goal is a submission I understand and can defend line by line, so explain before building.

## Never

- Modify `agent-service/` or `k8s/30-agent-service.yaml`, wherever they live (now under `starter/`).
  They're given, and graded against their own copy.
- Call agent-service `/admin/*` from our services. Admin endpoints are for proof scripts only.
- Commit before I've reviewed the diff and said so.

## Code rules

- **Type safety first:** no `any`, no loosely typed objects or ad-hoc dictionaries. Model data with explicit
  types and zod schemas; use discriminated unions for variants.
- **Readable, simple, clean:** small units with a single responsibility; clear names over comments.
- **No magic strings:** a value set used in more than one module is a named `as const` object with a type
  of the same name (`RiskLevel.High`, never `'HIGH'`). Literal tags are fine for a union used inside one file.
- **Prefer classes for stateful services** (clients, repositories, activity groups with dependencies).
  Temporal workflow code itself is a function, as the SDK requires.

## Recording our work

Update these as a side effect of the work, in the same session it happens, not at the end.

| File | Update when | Format |
|---|---|---|
| `APPROACH.md` | A phase starts or ends | Numbered phases, sub-phases allowed, one short sentence each |
| `docs/decisions.md` | We choose between real alternatives in the design | In order, numbered D1, D2…: chose, rejected, 2–3 short reasons |
| `docs/ai-log.md` | The agent (Claude) gets something wrong and we catch it | In order, numbered A1, A2…: requirement, file, wrong behaviour, how we noticed, fix |
| `proofs/` | A requirement gets verified | One script per requirement plus its captured output; index in `proofs/README.md` |

Spike first: before relying on how an external API or SDK behaves (agent-service, Temporal, k8s), confirm it
with a small runnable spike in `spikes/` (script plus a one-line finding). A claim taken only from docs is
marked unverified until a spike confirms it. A spike that contradicts what the agent said goes in the AI log.

At the end of every milestone, say explicitly whether it produced new AI-log entries, changes to
`decisions.md`, or anything worth noting for `NOTES.md`.

Before reporting a milestone done, and before every commit: `task check` passes (generate, typecheck,
lint + formatting, unit tests), plus `task test:db` when the data layer changed. Say so in the report.

Rules:
- Thin beats thorough. These feed `NOTES.md`, which is written last from them.
- AI log entries are honest and specific: "it fanned out all six; caught because `maxConcurrent` came back 6".
  Log a catch only if it would have broken a requirement or shipped broken (review catches count); small slips
  are just fixed. Entries below that bar stay in `ai-log.md` as comments, never deleted; `NOTES.md` draws from
  the shown ones.
- Wording: describe new parts of the stack by how they connect to my experience. Don't frame it
  as things I lack or need to learn.

Package-specific rules live in nested `CLAUDE.md` files (`packages/db`, `packages/contracts`, `apps/worker`). Add one only
for a practice that must be repeated and can't be read from the code itself.
