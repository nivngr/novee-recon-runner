# How I approached it

The phases I went through, in order, from receiving the assignment to submitting it.

1. **Understand the assignment.**
    1. *Analyze:* Claude read the brief, the starter kit and the agent-service source, and flagged the sharp edges the brief leaves unstated.
    2. *Map to my experience:* we connected each part of the stack to patterns from my own work (queues, workers, retries, containers).
    3. *Walk through it:* a Q&A session where I worked through the brief until I could explain every requirement in my own words.
2. **Explore agent-service (the first spike).** Ran it in plain Docker and poked every behaviour by hand (retries, idempotency, errors, stop, failure knobs, overlap) before writing any code.
3. **Map the fixed constraints.** Listed everything the brief decides in advance as a pre-submission checklist ([`docs/constraints.md`](docs/constraints.md)).
4. **Tech design, one decision at a time.** Each open question discussed, recorded in [`docs/decisions.md`](docs/decisions.md), and spiked where it depends on Temporal's behaviour (spike 01: the window; spike 02: read paths while the worker is down; spike 03: cancellation).
5. **Plan the build.** Turned the design into a system diagram, a short tech design and a detailed build spec with milestones ([`docs/design/`](docs/design/)).
6. **Build, milestone by milestone.** Each milestone ended with a demo and a review before its commit; the review
   reshaped the code more than once (named constants, nested settings, structured failures).
7. **Prove it.** One repeatable script per requirement, all run in one pass on a freshly created cluster
   ([`proofs/`](proofs/README.md)), plus manual testing in the UI, which found the hardest bug (A10).
8. **Write it up.** [`NOTES.md`](NOTES.md) from the records, then a dry run on a brand-new cluster
   following it literally.
