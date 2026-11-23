import {
  AgentStatus,
  AssessmentStatus,
  FailureCode,
  LostReason,
  PendingRequest,
  RiskLevel,
} from '@novee/contracts';

// What the UI calls each value. Records over the shared types, so a new status fails the typecheck until it has a label.

export const RUN_STATUS_LABEL: Readonly<Record<AssessmentStatus, string>> = {
  [AssessmentStatus.Starting]: 'Starting',
  [AssessmentStatus.Running]: 'Running',
  [AssessmentStatus.Aggregating]: 'Aggregating findings',
  [AssessmentStatus.AwaitingApproval]: 'Awaiting approval',
  [AssessmentStatus.Persisting]: 'Saving results',
  [AssessmentStatus.Completed]: 'Completed',
  [AssessmentStatus.Rejected]: 'Rejected',
  [AssessmentStatus.RejectedInput]: 'Domain not supported',
  [AssessmentStatus.Cancelled]: 'Cancelled',
  [AssessmentStatus.Failed]: 'Failed',
};

export const PENDING_LABEL: Readonly<Record<PendingRequest, string>> = {
  [PendingRequest.Cancelling]: 'cancelling…',
  [PendingRequest.Approving]: 'approving…',
  [PendingRequest.Rejecting]: 'rejecting…',
};

export const AGENT_STATUS_LABEL: Readonly<Record<AgentStatus, string>> = {
  [AgentStatus.Queued]: 'Queued',
  [AgentStatus.Starting]: 'Starting',
  [AgentStatus.Running]: 'Running',
  [AgentStatus.Completed]: 'Completed',
  [AgentStatus.Failed]: 'Failed (agent crashed)',
  [AgentStatus.Lost]: 'Lost',
  [AgentStatus.Stopped]: 'Stopped',
};

export const LOST_REASON_LABEL: Readonly<Record<LostReason, string>> = {
  [LostReason.StartFailed]: 'could not be started',
  [LostReason.NotFound]: 'unknown to agent-service',
  [LostReason.NoProgress]: 'no progress',
  [LostReason.Ceiling]: 'ran too long',
};

export const FAILURE_LABEL: Readonly<Record<FailureCode, string>> = {
  [FailureCode.NoAgentCompleted]: 'No agent completed',
  [FailureCode.WorkflowError]: 'The run hit an error',
  [FailureCode.EndedUnrecorded]: 'The run stopped without recording why',
};

export const RISK_LABEL: Readonly<Record<RiskLevel, string>> = {
  [RiskLevel.Critical]: 'Critical',
  [RiskLevel.High]: 'High',
  [RiskLevel.Medium]: 'Medium',
  [RiskLevel.Low]: 'Low',
};
