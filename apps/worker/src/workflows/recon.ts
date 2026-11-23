import {
  AgentStatus,
  AssessmentStatus,
  Decision,
  FailureCode,
  isActionLegal,
  LEGAL_STATUSES,
  LIVE_STATUSES,
  type ReconInput,
  type ReconResult,
  RunAction,
  type RunFailure,
  Signal,
  TECHNIQUES,
} from '@novee/contracts';
import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  log,
  setHandler,
  TemporalFailure,
} from '@temporalio/workflow';
import { FailureType } from '../activities/failure-types.js';
import { type StopReason, WaitOutcome } from '../activities/types.js';
import { activitiesFor, type ReconActivities } from './activity-proxies.js';
import { describeFailure, isFailureOfType, isTimeout } from './failures.js';

export const setWindowSignal = defineSignal<[number]>(Signal.SetWindow);
export const approveSignal = defineSignal(Signal.Approve);
export const rejectSignal = defineSignal(Signal.Reject);

/** One recon run (plan §4): N agents, at most `window` in flight, then aggregate, a human decision, persist. */
export async function recon(input: ReconInput): Promise<ReconResult> {
  return new ReconRun(input).execute();
}

/** One agent's slot in the run. */
interface Lane {
  readonly index: number;
  /** Set once its start succeeded: from then on there is an agent that may need stopping. */
  scanId?: string;
  /** Its ending is recorded (completed, failed, lost or stopped). */
  ended: boolean;
  /** Its start attempt is over, either way. */
  startSettled: boolean;
}

class ReconRun {
  private readonly activities: ReconActivities;
  private phase: AssessmentStatus = AssessmentStatus.Starting;
  private window: number;
  private running = 0;
  private completed = 0;
  private decision: Decision | null = null;
  private rejectedInput = false;
  /** A lane's real error (not a cancellation): ends the run as FAILED. */
  private laneError: unknown;
  private readonly lanes: Lane[] = [];
  private readonly laneTasks: Promise<void>[] = [];

  constructor(private readonly input: ReconInput) {
    this.activities = activitiesFor(input);
    this.window = input.windowSize;
    // Each handler re-checks the legality table: the API checked too, but only the workflow sees the real state.
    setHandler(setWindowSignal, (size) => {
      if (
        isActionLegal(RunAction.SetWindow, this.phase) &&
        Number.isInteger(size) &&
        size >= 1 &&
        size <= input.agentCount
      ) {
        this.window = size;
      }
    });
    setHandler(approveSignal, () => this.decide(Decision.Approve));
    setHandler(rejectSignal, () => this.decide(Decision.Reject));
  }

  async execute(): Promise<ReconResult> {
    try {
      return await this.runToEnd();
    } catch (error) {
      if (isCancellation(error)) {
        await CancellationScope.nonCancellable(() => this.cleanUpAfterCancel());
        throw error; // Temporal shows "cancelled"
      }
      if (error instanceof TemporalFailure) {
        await CancellationScope.nonCancellable(() =>
          this.moveTo(AssessmentStatus.Failed, LIVE_STATUSES, {
            code: FailureCode.WorkflowError,
            detail: describeFailure(error),
          }),
        );
      }
      throw error; // Temporal shows "failed": real breakage. A plain Error (a bug) retries the workflow task instead.
    }
  }

  private async runToEnd(): Promise<ReconResult> {
    await this.moveTo(AssessmentStatus.Running, [AssessmentStatus.Starting]);
    await this.startAllAgents();
    await Promise.allSettled(this.laneTasks);
    if (this.laneError !== undefined) throw this.laneError;

    if (this.rejectedInput) return this.finish(AssessmentStatus.RejectedInput, [AssessmentStatus.Running]);
    if (this.completed === 0)
      return this.finish(AssessmentStatus.Failed, [AssessmentStatus.Running], {
        code: FailureCode.NoAgentCompleted,
        detail: `none of the ${this.input.agentCount} agents completed`,
      });

    await this.moveTo(AssessmentStatus.Aggregating, [AssessmentStatus.Running]);
    await this.activities.aggregate(this.runRef());
    await this.moveTo(AssessmentStatus.AwaitingApproval, [AssessmentStatus.Aggregating]);
    await condition(() => this.decision !== null);
    if (this.decision === Decision.Reject) {
      return this.finish(AssessmentStatus.Rejected, [AssessmentStatus.AwaitingApproval]);
    } // staged findings are kept

    await this.moveTo(AssessmentStatus.Persisting, [AssessmentStatus.AwaitingApproval]);
    // Never interrupted halfway: persist writes the result and COMPLETED in one transaction.
    await CancellationScope.nonCancellable(() => this.activities.persist(this.runRef()));
    this.phase = AssessmentStatus.Completed;
    return AssessmentStatus.Completed;
  }

  /** The sliding window (D2): a new lane starts whenever one ends, up to the current window. */
  private async startAllAgents(): Promise<void> {
    for (let index = 0; index < this.input.agentCount; index++) {
      await condition(() => this.running < this.window || this.laneError !== undefined);
      // The first agent starts alone: an unsupported domain is then refused after exactly one start (R5).
      if (index === 1) await condition(() => this.lanes[0]?.startSettled === true);
      if (this.rejectedInput || this.laneError !== undefined) return;

      const lane: Lane = { index, ended: false, startSettled: false };
      this.running += 1;
      this.lanes.push(lane);
      const task = this.runLane(lane);
      // Handle every lane's rejection right away, or it would fail the workflow task (A2).
      task.catch((error: unknown) => {
        if (!isCancellation(error)) this.laneError ??= error;
      });
      this.laneTasks.push(task);
    }
  }

  private async runLane(lane: Lane): Promise<void> {
    try {
      const scanId = await this.startLane(lane);
      if (scanId === undefined) return;
      const result = await this.activities.waitAgent({
        ...this.agentRef(lane),
        scanId,
        stallTimeoutS: this.input.settings.stallTimeoutS,
        maxAgentDurationS: this.input.settings.maxAgentDurationS,
      });
      if (result.outcome === WaitOutcome.Completed) this.completed += 1;
      if (result.outcome === WaitOutcome.NoProgress || result.outcome === WaitOutcome.Ceiling) {
        await this.stop(lane, scanId, { status: AgentStatus.Lost, lostReason: result.outcome });
      }
      lane.ended = true;
    } finally {
      this.running -= 1; // any ending frees the slot
    }
  }

  /** The scan id, or undefined if the agent never started (and its ending is recorded). */
  private async startLane(lane: Lane): Promise<string | undefined> {
    try {
      // A start in flight is never cancelled: we must learn its scan id to be able to stop it.
      const scanId = await CancellationScope.nonCancellable(() =>
        this.activities.startAgent({
          ...this.agentRef(lane),
          domain: this.input.domain,
          technique: TECHNIQUES[lane.index % TECHNIQUES.length] ?? TECHNIQUES[0],
        }),
      );
      lane.scanId = scanId;
      return scanId;
    } catch (error) {
      if (isFailureOfType(error, FailureType.UnsupportedDomain)) this.rejectedInput = true;
      else if (!isTimeout(error)) throw error; // BadRequest: our bug, the run fails
      log.warn('agent did not start', { index: lane.index, reason: String(error) });
      await CancellationScope.nonCancellable(() => this.activities.markStartFailed(this.agentRef(lane)));
      lane.ended = true;
      return undefined;
    } finally {
      lane.startSettled = true;
    }
  }

  /** Stops an agent and records how it ended; if agent-service never confirms, the run still ends (D6). */
  private async stop(lane: Lane, scanId: string, endAs: StopReason): Promise<void> {
    await CancellationScope.nonCancellable(async () => {
      try {
        await this.activities.stopAgent({ ...this.agentRef(lane), scanId, endAs });
      } catch (error) {
        if (!isTimeout(error)) throw error;
        await this.activities.markStopUnconfirmed({ ...this.agentRef(lane), endAs });
      }
    });
    lane.ended = true;
  }

  /** In-flight starts finish, every started agent that hasn't ended is stopped, then the run is CANCELLED (D6). */
  private async cleanUpAfterCancel(): Promise<void> {
    await Promise.allSettled(this.laneTasks);
    await Promise.all(
      this.lanes.flatMap((lane) =>
        lane.scanId !== undefined && !lane.ended
          ? [this.stop(lane, lane.scanId, { status: AgentStatus.Stopped })]
          : [],
      ),
    );
    await this.moveTo(AssessmentStatus.Cancelled, LEGAL_STATUSES[RunAction.Cancel]);
  }

  private decide(decision: Decision): void {
    if (isActionLegal(RunAction.Approve, this.phase) && this.decision === null) this.decision = decision; // first wins
  }

  private async finish(
    to: ReconResult,
    from: readonly AssessmentStatus[],
    failure?: RunFailure,
  ): Promise<ReconResult> {
    await this.moveTo(to, from, failure);
    return to;
  }

  /**
   * The workflow's phase moves first, then the database row (D5). The API allows an action once the *row* shows
   * the status, so the phase must already be there when the signal lands, or the handler would drop it.
   */
  private async moveTo(
    to: AssessmentStatus,
    from: readonly AssessmentStatus[],
    failure?: RunFailure,
  ): Promise<void> {
    this.phase = to;
    await this.activities.setRunStatus({ ...this.runRef(), from, to, failure });
  }

  private runRef() {
    return { runId: this.input.runId, failFirstAttempts: this.input.settings.failFirstAttempts };
  }

  private agentRef(lane: Lane) {
    return { ...this.runRef(), index: lane.index };
  }
}
