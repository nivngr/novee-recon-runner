import { type ReconInput, Signal, WORKFLOW_TYPE, workflowIdFor } from '@novee/contracts';
import { type Client, WorkflowNotFoundError } from '@temporalio/client';

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

  /** True when Temporal has no running workflow for the run: it ended, or never started. */
  async hasEnded(runId: string): Promise<boolean> {
    try {
      const description = await this.handle(runId).describe();
      return description.status.name !== 'RUNNING';
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return true;
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
