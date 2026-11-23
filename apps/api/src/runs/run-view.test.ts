import {
  AgentStatus,
  AssessmentStatus,
  Decision,
  FailureCode,
  LostReason,
  PendingRequest,
  RunAction,
} from '@novee/contracts';
import type { AgentRecord, RunRecord } from '@novee/db';
import { describe, expect, it } from 'vitest';
import { ENDED_UNRECORDED, toRunView } from './run-view.js';

const CREATED = new Date('2026-11-23T10:00:00Z');

function agent(index: number, status: AgentStatus, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: BigInt(index + 1),
    assessmentId: 'run-1',
    agentIndex: index,
    technique: 'dns-brute',
    scanId: null,
    status,
    lostReason: null,
    stopConfirmed: null,
    progress: 0,
    discoveredCount: null,
    worker: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: CREATED,
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    targetDomain: 'example.com',
    agentCount: 3,
    windowSize: 2,
    status: AssessmentStatus.Running,
    stallTimeoutS: 60,
    maxAgentDurationS: 300,
    failFirstAttempts: 0,
    cancelRequestedAt: null,
    decision: null,
    decisionRequestedAt: null,
    uniqueDomains: null,
    criticalCount: null,
    highCount: null,
    mediumCount: null,
    lowCount: null,
    failureCode: null,
    failureReason: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    agents: [agent(0, AgentStatus.Completed), agent(1, AgentStatus.Running), agent(2, AgentStatus.Queued)],
    ...overrides,
  };
}

describe('toRunView', () => {
  it('counts agents by status, starting ones as running', () => {
    const view = toRunView(
      run({
        agents: [
          agent(0, AgentStatus.Starting),
          agent(1, AgentStatus.Running),
          agent(2, AgentStatus.Lost, { lostReason: LostReason.NoProgress }),
        ],
      }),
      false,
    );
    expect(view.counts).toEqual({ queued: 0, running: 2, completed: 0, failed: 0, lost: 1, stopped: 0 });
  });

  it('offers the actions the legality table allows for the status', () => {
    expect(toRunView(run({ status: AssessmentStatus.Running }), false).allowedActions).toEqual([
      RunAction.Cancel,
      RunAction.SetWindow,
    ]);
    expect(toRunView(run({ status: AssessmentStatus.AwaitingApproval }), false).allowedActions).toEqual([
      RunAction.Approve,
      RunAction.Reject,
      RunAction.Cancel,
    ]);
    expect(toRunView(run({ status: AssessmentStatus.Completed }), false).allowedActions).toEqual([]);
  });

  it('shows a pending request and offers nothing while it is pending', () => {
    const approving = toRunView(
      run({
        status: AssessmentStatus.AwaitingApproval,
        decision: Decision.Approve,
        decisionRequestedAt: CREATED,
      }),
      false,
    );
    expect([approving.pending, approving.allowedActions]).toEqual([PendingRequest.Approving, []]);

    const cancelling = toRunView(run({ cancelRequestedAt: CREATED }), false);
    expect([cancelling.pending, cancelling.allowedActions]).toEqual([PendingRequest.Cancelling, []]);
  });

  it('drops the pending label once the run has ended', () => {
    const view = toRunView(run({ status: AssessmentStatus.Cancelled, cancelRequestedAt: CREATED }), false);
    expect(view.pending).toBeNull();
  });

  it('reports FAILED when Temporal says the workflow ended but the row still says live', () => {
    const view = toRunView(run({ status: AssessmentStatus.Running }), true);
    expect([view.status, view.failure, view.allowedActions]).toEqual([
      AssessmentStatus.Failed,
      ENDED_UNRECORDED,
      [],
    ]);
  });

  it('reports a stored failure as its code and detail', () => {
    const view = toRunView(
      run({
        status: AssessmentStatus.Failed,
        failureCode: FailureCode.NoAgentCompleted,
        failureReason: 'none of the 3 agents completed',
      }),
      false,
    );
    expect(view.failure).toEqual({
      code: FailureCode.NoAgentCompleted,
      detail: 'none of the 3 agents completed',
    });
  });

  it('has a summary only once aggregate has written one', () => {
    expect(toRunView(run(), false).summary).toBeNull();
    expect(
      toRunView(run({ uniqueDomains: 3, criticalCount: 1, highCount: 2, mediumCount: 0, lowCount: 0 }), false)
        .summary,
    ).toEqual({ uniqueDomains: 3, critical: 1, high: 2, medium: 0, low: 0 });
  });
});
