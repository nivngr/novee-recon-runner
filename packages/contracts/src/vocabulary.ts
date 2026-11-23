// The words the whole system shares. Each set is a named object (use `RiskLevel.High`, never 'HIGH') with a
// type of the same name. The database enums mirror these exactly (checked at compile time in packages/db).

/** Agents are assigned a technique round-robin: TECHNIQUES[agentIndex % 4]. */
export const TECHNIQUES = ['dns-brute', 'cert-transparency', 'passive-dns', 'web-crawl'] as const;
export type Technique = (typeof TECHNIQUES)[number];

/** Declared least to most severe: the database sorts the enum this way, so "most severe" is max(risk). */
export const RiskLevel = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', Critical: 'CRITICAL' } as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const AssessmentStatus = {
  Starting: 'STARTING',
  Running: 'RUNNING',
  Aggregating: 'AGGREGATING',
  AwaitingApproval: 'AWAITING_APPROVAL',
  Persisting: 'PERSISTING',
  Completed: 'COMPLETED',
  Rejected: 'REJECTED',
  RejectedInput: 'REJECTED_INPUT',
  Cancelled: 'CANCELLED',
  Failed: 'FAILED',
} as const;
export type AssessmentStatus = (typeof AssessmentStatus)[keyof typeof AssessmentStatus];

/** Statuses a run can still move on from. */
export const LIVE_STATUSES: readonly AssessmentStatus[] = [
  AssessmentStatus.Starting,
  AssessmentStatus.Running,
  AssessmentStatus.Aggregating,
  AssessmentStatus.AwaitingApproval,
  AssessmentStatus.Persisting,
];

export const AgentStatus = {
  Queued: 'QUEUED',
  Starting: 'STARTING',
  Running: 'RUNNING',
  Completed: 'COMPLETED',
  /** The agent said so. */
  Failed: 'FAILED',
  /** We gave up on it. */
  Lost: 'LOST',
  /** Stopped by a cancel. */
  Stopped: 'STOPPED',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const LostReason = {
  StartFailed: 'START_FAILED',
  NotFound: 'NOT_FOUND',
  NoProgress: 'NO_PROGRESS',
  Ceiling: 'CEILING',
} as const;
export type LostReason = (typeof LostReason)[keyof typeof LostReason];

/** Why a run ended FAILED. */
export const FailureCode = {
  /** Every agent failed or was lost. */
  NoAgentCompleted: 'NO_AGENT_COMPLETED',
  /** A real error stopped the workflow (e.g. agent-service rejected our request as malformed). */
  WorkflowError: 'WORKFLOW_ERROR',
  /** Temporal says the workflow ended, but it never recorded how (reported by the API, never stored). */
  EndedUnrecorded: 'ENDED_UNRECORDED',
} as const;
export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

/** A run-level failure: a code to act on, a detail for people. */
export interface RunFailure {
  code: FailureCode;
  detail: string;
}

export const Decision = { Approve: 'APPROVE', Reject: 'REJECT' } as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

/** Where a run's domain list comes from: the deduplicated staged findings, or the stored result after approve. */
export const DomainSource = { Staged: 'staged', Final: 'final' } as const;
export type DomainSource = (typeof DomainSource)[keyof typeof DomainSource];
