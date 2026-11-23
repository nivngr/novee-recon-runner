# Fixed constraints

Everything the brief decides in advance. Tick each before submitting. Anything not listed here is our call,
and the brief says so explicitly.

All ticked on 2026-11-23, each against evidence: the proofs (`proofs/README.md`), the code, and `NOTES.md`.

## Stack
- [x] Backend in **Go or TypeScript**.
- [x] **At least two separate deployables**: an API and a worker. One process doing both is not allowed.
- [x] Frontend in **React with Next.js**.
- [x] **Temporal** does the orchestration. No cron loop, home-made queue or `setInterval`.
- [x] Results land in **Postgres**. The schema is ours.
- [x] **agent-service and its manifest are not modified**, and our services never call its `/admin/*`.
- [x] Runs on **local k3s**, namespace **`novee-task`**.

## Product
- [x] User inputs: **target domain, number of agents, window size (default 2)**.
- [x] Flow: run agents under the window → aggregate (deduplicated union, with risk) → wait for a human →
      persist to Postgres **on approve only**.
- [x] User actions: **approve, reject, cancel**, and **change the window mid-run**.
- [x] Status names: live = running, aggregating, awaiting a human, persisting; terminal = `COMPLETED`,
      `REJECTED`, `REJECTED_INPUT`, `CANCELLED`, `FAILED`. Renaming is allowed if NOTES gives the mapping.

## Hard numbers in R1–R9
- [x] R1: `maxConcurrent` exactly W, sliding (no batches), resizable mid-run without restart or killing agents.
- [x] R2: after a worker crash, `totalStarted` = agent count and stored domains = union of that run's agents.
- [x] R3: exactly N agents started, each domain once, one row per agent, after forced retries.
- [x] R5: a `.invalid` domain reaches `REJECTED_INPUT` **within 30s**, `totalStarted` 0, **exactly one** start attempt.
- [x] R7: after cancel, **no agent left `RUNNING`**, run `CANCELLED`.
- [x] R8: polling **stops** at terminal; buttons enabled only when legal, disabled mid-request; never
      optimistically terminal.
- [x] R9: worker is **not an HTTP server**, has **no Service**, has a **liveness signal** and **resource requests**.
- [x] R9: **one command** from an empty k3s cluster to the whole stack (build, load, apply), no manual steps.
- [x] Must hold against **their** agent-service defaults: 2× 503 per domain, 10s–2m agents, 250 results,
      with fault knobs set by them.

## Submission
- [x] A repo (zip or link) with code, manifests, and a **task runner** (Taskfile preferred) covering infra
      bring-up, image build and load, and deploy.
- [x] **`NOTES.md`**, read first: how to run it (clean machine, every command, the image-load step, k3s
      flavour); architecture, rejected options, how the window works, our HTTP API; proof per requirement
      (incl. the R3 retry switch and `maxConcurrent` / `totalStarted`); trade-offs and **AI log**; what next;
      time spent.
- [x] **Commit as we go**; decisions written down.
- [x] Proofs are **repeatable**.
- [x] Ambiguities resolved by a **written assumption**.

## Graded, not mandatory
- [x] A test that would catch a real regression (code quality, 15%).
- [x] About **24 hours** of work: a budget, not a deadline.
