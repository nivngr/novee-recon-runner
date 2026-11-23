import { type ReconInput, Signal, WORKFLOW_STEP, WORKFLOW_TYPE, workflowIdFor } from '@novee/contracts';
import { type Client, WorkflowNotFoundError } from '@temporalio/client';

/** The workflow's own step failing this many times in a row is no longer a blip: it's a bug, waiting for a fix. */
const WORKFLOW_STUCK_AFTER_ATTEMPTS = 3;
/**
 * An activity with no deadline (the database writes, waitAgent) failing this many times beyond any injected
 * failures is stuck. Activities with a deadline (startAgent, stopAgent) give up on their own, so they never count.
 */
const ACTIVITY_STUCK_AFTER_EXTRA_ATTEMPTS = 5;

export const WorkflowState = { Healthy: 'healthy', Ended: 'ended', Stuck: 'stuck' } as const;

export type WorkflowCheck =
  | { state: typeof WorkflowState.Healthy }
  | { state: typeof WorkflowState.Ended }
  | { state: typeof WorkflowState.Stuck; step: string; attempt: number; lastError: string | null };

/** The API's side of the recon workflow: start it, signal it, cancel it, ask whether it has ended. */
export class RunWorkflows {
  constructor(
    private readonly client: Client,
    private readonly taskQueue: string,
  ) {}

  /** Safe to repeat: a second start of the same run returns the running workflow (spike 05). */
  async start(input: ReconInput): Promise<void> {
    await this.client.workflow.start(WORKFLOW_TYPE, {
      taskQueue: this.taskQueue,
      workflowId: workflowIdFor(input.runId),
      workflowIdConflictPolicy: 'USE_EXISTING',
      args: [input],
    });
  }

  async approve(runId: string): Promise<void> {
    await this.handle(runId).signal(Signal.Approve);
  }

  async reject(runId: string): Promise<void> {
    await this.handle(runId).signal(Signal.Reject);
  }

  async setWindow(runId: string, size: number): Promise<void> {
    await this.handle(runId).signal(Signal.SetWindow, size);
  }

  async cancel(runId: string): Promise<void> {
    await this.handle(runId).cancel();
  }

  /**
   * How the run's workflow is doing, as Temporal sees it: ended (or never started), stuck (its own step keeps
   * failing, e.g. after a code change it can't replay; or an activity with no deadline keeps failing), or healthy.
   * `injectedFailures` is the run's failFirstAttempts: those failures are expected, not a sign of being stuck.
   */
  async check(runId: string, injectedFailures: number): Promise<WorkflowCheck> {
    try {
      const { status, raw } = await this.handle(runId).describe();
      if (status.name !== 'RUNNING') return { state: WorkflowState.Ended };
      const workflowAttempt = raw.pendingWorkflowTask?.attempt ?? 0;
      if (workflowAttempt >= WORKFLOW_STUCK_AFTER_ATTEMPTS) {
        return { state: WorkflowState.Stuck, step: WORKFLOW_STEP, attempt: workflowAttempt, lastError: null };
      }
      const activity = (raw.pendingActivities ?? []).find(
        (pending) =>
          pending.expirationTime == null &&
          (pending.attempt ?? 0) >= injectedFailures + ACTIVITY_STUCK_AFTER_EXTRA_ATTEMPTS,
      );
      if (activity !== undefined) {
        return {
          state: WorkflowState.Stuck,
          step: activity.activityType?.name ?? 'an activity',
          attempt: activity.attempt ?? 0,
          lastError: lastLine(activity.lastFailure?.message),
        };
      }
      return { state: WorkflowState.Healthy };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return { state: WorkflowState.Ended };
      throw error;
    }
  }

  /** Throws if Temporal can't be reached. */
  async ping(): Promise<void> {
    await this.client.workflowService.getSystemInfo({});
  }

  private handle(runId: string) {
    return this.client.workflow.getHandle(workflowIdFor(runId));
  }
}

/** Errors can span lines (Prisma's do, with the cause last); one line is enough for the UI. */
function lastLine(message: string | null | undefined): string | null {
  const lines = (message ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) ?? null;
}
