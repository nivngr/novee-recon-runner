# AI log

Where the coding agent got it wrong, and how we noticed. In the order it happened.

## A1 — Design — padded "rejected alternatives" *(optional: decide later if it fits)*
**File:** `docs/decisions.md` (D2, D4 drafts)
**Wrong behaviour:** the agent listed alternatives the brief forbids or nobody would build (fan-out, cron,
agent-service's own cap; Redis for staging), making the comparison look broader than it was.
**How we noticed:** I asked for one genuine rejected alternative; most of the list didn't survive the question.
**Fix:** each decision now names only genuine alternatives (child workflows for D2, re-fetching for D4).

<!--
## A<n> — <requirement or spike> — <one-line summary>
**File:** …
**Wrong behaviour:** …
**How we noticed:** …
**Fix:** …
-->
