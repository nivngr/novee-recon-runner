# How I approached it

The phases I went through, in order, from receiving the assignment to submitting it.

1. **Understand the assignment.**
    1. *Analyze:* Claude read the brief, the starter kit and the agent-service source, and flagged the sharp edges the brief leaves unstated.
    2. *Map to my experience:* we connected each part of the stack to patterns from my own work (queues, workers, retries, containers).
    3. *Walk through it:* a Q&A session where I worked through the brief until I could explain every requirement in my own words.
2. **Explore agent-service (the first spike).** Ran it in plain Docker and poked every behaviour by hand (retries, idempotency, errors, stop, failure knobs, overlap) before writing any code.
3. **Map the fixed constraints.** Listed everything the brief decides in advance as a pre-submission checklist ([`docs/constraints.md`](docs/constraints.md)).
4. **Tech design, one decision at a time** *(in progress)*. Each open question discussed, recorded in [`docs/decisions.md`](docs/decisions.md), and spiked where it depends on Temporal's behaviour (spike 01: the window; spike 02: read paths while the worker is down).
