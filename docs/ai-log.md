# AI log

Where the coding agent got it wrong, and how we noticed. Newest first.

## 2026-11-21 — Spike 01 — misleading "result" timestamp
**File:** `spikes/01-window/src/client.ts`
**Wrong behaviour:** the timestamp was taken before awaiting the result, so the run looked finished the
moment the window was raised.
**How we noticed:** the result line had the same timestamp as the signal, while agent-service's timeline
showed agents still running 25s later.
**Fix:** await the result first, then log.

<!--
## YYYY-MM-DD — <requirement> — <one-line summary>
**File:** …
**Wrong behaviour:** …
**How we noticed:** …
**Fix:** …
-->
