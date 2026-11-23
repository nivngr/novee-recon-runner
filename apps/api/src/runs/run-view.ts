import {
  AgentStatus,
  type AgentView,
  AssessmentStatus,
  Decision,
  FailureCode,
  isActionLegal,
  LIVE_STATUSES,
  PendingRequest,
  RunAction,
  type RunCounts,
  type RunFailure,
  type RunView,
  TECHNIQUES,
  type Technique,
} from '@novee/contracts';
import type { AgentRecord, RunRecord } from '@novee/db';
import { type WorkflowCheck, WorkflowState } from '../temporal/run-workflows.js';

const HEALTHY: WorkflowCheck = { state: WorkflowState.Healthy };

/** Reported when Temporal says the workflow ended but the row still says it's live (D5's safety net). */
export const ENDED_UNRECORDED: RunFailure = {
  code: FailureCode.EndedUnrecorded,
  detail: 'the workflow ended without recording its outcome',
};

/**
 * The run as the UI sees it. `workflow` is Temporal's view, checked only for live runs (D5's safety net): if the
 * workflow ended without recording it, the view says FAILED instead of showing progress that will never come; if
 * it's stuck, the view says so, keeping the recorded status (it resumes once the problem is fixed) (R8).
 */
export function toRunView(run: RunRecord, workflow: WorkflowCheck = HEALTHY): RunView {
  const workflowEnded = workflow.state === WorkflowState.Ended;
  const status = workflowEnded ? AssessmentStatus.Failed : run.status;
  const pending = workflowEnded ? null : pendingRequestOf(run);
  return {
    id: run.id,
    domain: run.targetDomain,
    agentCount: run.agentCount,
    window: run.windowSize,
    status,
    pending,
    stuck:
      workflow.state === WorkflowState.Stuck
        ? { step: workflow.step, attempt: workflow.attempt, lastError: workflow.lastError }
        : null,
    counts: countAgents(run),
    summary:
      run.uniqueDomains === null
        ? null
        : {
            uniqueDomains: run.uniqueDomains,
            critical: run.criticalCount ?? 0,
            high: run.highCount ?? 0,
            medium: run.mediumCount ?? 0,
            low: run.lowCount ?? 0,
          },
    agents: run.agents.map(toAgentView),
    allowedActions:
      pending === null ? Object.values(RunAction).filter((action) => isActionLegal(action, status)) : [],
    failure: workflowEnded ? ENDED_UNRECORDED : failureOf(run),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

/** The stored failure: written together with FAILED, so the code and its detail come as a pair. */
function failureOf(run: RunRecord): RunFailure | null {
  return run.failureCode === null ? null : { code: run.failureCode, detail: run.failureReason ?? '' };
}

/** A request the workflow hasn't acted on yet. Only a live run can have one. Used by the run page and the list. */
export function pendingRequestOf(
  run: Pick<RunRecord, 'status' | 'cancelRequestedAt' | 'decision'>,
): PendingRequest | null {
  if (!LIVE_STATUSES.includes(run.status)) return null;
  if (run.cancelRequestedAt !== null) return PendingRequest.Cancelling;
  if (run.status === AssessmentStatus.AwaitingApproval && run.decision !== null) {
    return run.decision === Decision.Approve ? PendingRequest.Approving : PendingRequest.Rejecting;
  }
  return null;
}

function countAgents(run: RunRecord): RunCounts {
  const count = (...statuses: AgentStatus[]) =>
    run.agents.filter((agent) => statuses.includes(agent.status)).length;
  return {
    queued: count(AgentStatus.Queued),
    running: count(AgentStatus.Starting, AgentStatus.Running),
    completed: count(AgentStatus.Completed),
    failed: count(AgentStatus.Failed),
    lost: count(AgentStatus.Lost),
    stopped: count(AgentStatus.Stopped),
  };
}

function toAgentView(agent: AgentRecord): AgentView {
  return {
    index: agent.agentIndex,
    technique: asTechnique(agent.technique),
    status: agent.status,
    progress: agent.progress,
    discoveredCount: agent.discoveredCount,
    lostReason: agent.lostReason,
    stopConfirmed: agent.stopConfirmed,
    worker: agent.worker,
  };
}

/** The column is plain text in the database; only our code writes it, from TECHNIQUES. */
function asTechnique(value: string): Technique {
  const technique = TECHNIQUES.find((known) => known === value);
  if (technique === undefined) throw new Error(`unknown technique in the database: ${value}`);
  return technique;
}
