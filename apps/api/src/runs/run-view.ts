import {
  AgentStatus,
  type AgentView,
  AssessmentStatus,
  Decision,
  isActionLegal,
  LIVE_STATUSES,
  PendingRequest,
  RunAction,
  type RunCounts,
  type RunView,
  TECHNIQUES,
  type Technique,
} from '@novee/contracts';
import type { AgentRecord, RunRecord } from '@novee/db';

/** Shown when Temporal says the workflow ended but the row still says it's live (D5's safety net). */
export const ENDED_WITHOUT_RECORD = 'the workflow ended without recording its outcome';

/**
 * The run as the UI sees it. `workflowEnded`: Temporal reports no running workflow for a run the database still
 * calls live; the view then says FAILED instead of showing progress that will never come (R8).
 */
export function toRunView(run: RunRecord, workflowEnded: boolean): RunView {
  const status = workflowEnded ? AssessmentStatus.Failed : run.status;
  const pending = workflowEnded ? null : pendingRequestOf(run);
  return {
    id: run.id,
    domain: run.targetDomain,
    agentCount: run.agentCount,
    window: run.windowSize,
    status,
    pending,
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
    failureReason: workflowEnded ? ENDED_WITHOUT_RECORD : run.failureReason,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

/** A request the workflow hasn't acted on yet. Only a live run can have one. */
function pendingRequestOf(run: RunRecord): PendingRequest | null {
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
