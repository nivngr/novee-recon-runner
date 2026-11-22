# CLAUDE.md

Novee take-home: a Temporal-orchestrated recon-agent runner (brief: `brief/README.md`, local only and git-ignored; starter kit: `starter/`).
The goal is a submission I understand and can defend line by line, so explain before building.

## Never

- Modify `agent-service/` or `k8s/30-agent-service.yaml`, wherever they live (now under `starter/`).
  They're given, and graded against their own copy.
- Call agent-service `/admin/*` from our services. Admin endpoints are for proof scripts only.
- Commit before I've reviewed the diff and said so.

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

Rules:
- Thin beats thorough. These feed `NOTES.md`, which is written last from them.
- AI log entries are honest and specific: "it fanned out all six; caught because `maxConcurrent` came back 6".
  Log every catch, including ones caught in review before running.
- Wording: describe new parts of the stack by how they connect to my experience. Don't frame it
  as things I lack or need to learn.
