import type { RunLifecycle, RunSummary } from '@novee/db';
import { failIfInjected } from './failures.js';
import type { RunRef, SetRunStatusInput } from './types.js';

/** The workflow's writes to the run row. Each is safe to repeat. */
export class RunActivities {
  // `#` field: the worker registers this object's own properties as activities, and this isn't one.
  readonly #runs: RunLifecycle;

  constructor(runs: RunLifecycle) {
    this.#runs = runs;
  }

  setRunStatus = async (input: SetRunStatusInput): Promise<boolean> => {
    const moved = await this.#runs.setRunStatus(input.runId, input.from, input.to, input.failureReason);
    failIfInjected(input.failFirstAttempts);
    return moved;
  };

  aggregate = async (input: RunRef): Promise<RunSummary> => {
    const summary = await this.#runs.aggregate(input.runId);
    failIfInjected(input.failFirstAttempts);
    return summary;
  };

  /** Copies the approved result and moves PERSISTING → COMPLETED, in one transaction. */
  persist = async (input: RunRef): Promise<void> => {
    await this.#runs.approve(input.runId);
    failIfInjected(input.failFirstAttempts);
  };
}
