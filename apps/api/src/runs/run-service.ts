import {
  type ActionResponse,
  Decision,
  type DomainsResponse,
  ErrorCode,
  LIVE_STATUSES,
  RunAction,
  type RunList,
  type RunView,
  type SubmitResponse,
  type ValidSubmitRequest,
  type WindowResponse,
} from '@novee/contracts';
import { CreateRunResult, type RunReader, type RunRecord, type RunRequests } from '@novee/db';
import type { RunWorkflows } from '../temporal/run-workflows.js';
import { toRunView } from './run-view.js';

/** A service call's outcome: a value, or an error code the HTTP layer maps to a status. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode; message: string };

/** The user's actions that go through the workflow as a request (setWindow has its own path). */
export type RequestAction = typeof RunAction.Approve | typeof RunAction.Reject | typeof RunAction.Cancel;

/** Workflow ended but row still live: only checked for runs at least this old (D5's safety net). */
const SAFETY_NET_MIN_AGE_MS = 30_000;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: ErrorCode, message: string): Result<T> => ({ ok: false, error, message });

/** The API's use cases. Reads come from the database (D5); requests are checked against the legality table. */
export class RunService {
  constructor(
    private readonly reader: RunReader,
    private readonly requests: RunRequests,
    private readonly workflows: RunWorkflows,
  ) {}

  /** Safe to repeat (D12): the same request returns the same run, and the workflow start is "use existing". */
  async submit(request: ValidSubmitRequest): Promise<Result<SubmitResponse & { created: boolean }>> {
    const created = await this.requests.createRun(request);
    if (created === CreateRunResult.Conflict) {
      return fail(ErrorCode.IdConflict, `run ${request.id} already exists with different parameters`);
    }
    try {
      await this.workflows.start({
        runId: request.id,
        domain: request.domain,
        agentCount: request.agentCount,
        windowSize: request.windowSize,
        settings: request.settings,
      });
    } catch (error) {
      // The rows exist; repeating the same submit starts the workflow then.
      return fail(ErrorCode.Unavailable, `could not start the workflow: ${String(error)}`);
    }
    return ok({ id: request.id, created: created === CreateRunResult.Created });
  }

  async get(id: string): Promise<Result<RunView>> {
    const run = await this.reader.getRun(id);
    if (run === null) return fail(ErrorCode.NotFound, `no run ${id}`);
    return ok(toRunView(run, await this.workflowEndedUnrecorded(run)));
  }

  async list(limit: number): Promise<RunList> {
    const runs = await this.reader.listRuns(limit);
    return runs.map((run) => ({
      id: run.id,
      domain: run.targetDomain,
      status: run.status,
      agentCount: run.agentCount,
      createdAt: run.createdAt.toISOString(),
    }));
  }

  async domains(id: string): Promise<Result<DomainsResponse>> {
    const domains = await this.reader.getDomains(id);
    return domains === null ? fail(ErrorCode.NotFound, `no run ${id}`) : ok(domains);
  }

  /**
   * Approve, reject or cancel. The request is recorded first (conditional: the first of two racing requests
   * wins, the other gets not_allowed), then sent to the workflow. If sending fails, the record is withdrawn.
   */
  async request(id: string, action: RequestAction): Promise<Result<ActionResponse>> {
    const checked = await this.checkAllowed(id, action);
    if (!checked.ok) return checked;
    const recorded =
      action === RunAction.Cancel
        ? await this.requests.requestCancel(id)
        : await this.requests.requestDecision(
            id,
            action === RunAction.Approve ? Decision.Approve : Decision.Reject,
          );
    if (!recorded) return fail(ErrorCode.NotAllowed, `${action} is no longer allowed for run ${id}`);
    try {
      await this.send(id, action);
    } catch (error) {
      await (action === RunAction.Cancel
        ? this.requests.withdrawCancel(id)
        : this.requests.withdrawDecision(id));
      return fail(ErrorCode.Unavailable, `could not reach the workflow: ${String(error)}`);
    }
    return ok({ status: checked.value.status });
  }

  /** Sent to the workflow first, then recorded: if the record fails, repeating the request fixes it. */
  async setWindow(id: string, size: number): Promise<Result<WindowResponse>> {
    const checked = await this.checkAllowed(id, RunAction.SetWindow);
    if (!checked.ok) return checked;
    if (size > checked.value.agentCount) {
      return fail(ErrorCode.ValidationFailed, `window must be between 1 and ${checked.value.agentCount}`);
    }
    try {
      await this.workflows.setWindow(id, size);
    } catch (error) {
      return fail(ErrorCode.Unavailable, `could not reach the workflow: ${String(error)}`);
    }
    const recorded = await this.requests.setWindow(id, size);
    if (!recorded) return fail(ErrorCode.NotAllowed, `the window can no longer be changed for run ${id}`);
    return ok({ window: size });
  }

  /** Throws if the database or Temporal can't be reached. */
  async checkHealth(): Promise<void> {
    await Promise.all([this.reader.listRuns(1), this.workflows.ping()]);
  }

  private async checkAllowed(id: string, action: RunAction): Promise<Result<RunRecord>> {
    const run = await this.reader.getRun(id);
    if (run === null) return fail(ErrorCode.NotFound, `no run ${id}`);
    const view = toRunView(run, false);
    if (!view.allowedActions.includes(action)) {
      const reason =
        view.pending === null ? `the run is ${view.status}` : `a request is pending (${view.pending})`;
      return fail(ErrorCode.NotAllowed, `${action} is not allowed: ${reason}`);
    }
    return ok(run);
  }

  private send(id: string, action: RequestAction): Promise<void> {
    switch (action) {
      case RunAction.Approve:
        return this.workflows.approve(id);
      case RunAction.Reject:
        return this.workflows.reject(id);
      case RunAction.Cancel:
        return this.workflows.cancel(id);
    }
  }

  /** The safety net: a live row whose workflow Temporal no longer runs. Temporal unreachable = trust the row. */
  private async workflowEndedUnrecorded(run: RunRecord): Promise<boolean> {
    const live = LIVE_STATUSES.includes(run.status);
    const oldEnough = Date.now() - run.createdAt.getTime() >= SAFETY_NET_MIN_AGE_MS;
    if (!live || !oldEnough) return false;
    try {
      return await this.workflows.hasEnded(run.id);
    } catch {
      return false;
    }
  }
}
