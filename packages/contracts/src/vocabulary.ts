// The words the whole system shares: statuses, risk levels, techniques. The database enums mirror these
// lists exactly (checked at compile time in packages/db), so the API, worker and UI can't drift apart.

export const TECHNIQUES = ['dns-brute', 'cert-transparency', 'passive-dns', 'web-crawl'] as const;
export type Technique = (typeof TECHNIQUES)[number];

/** Ordered least to most severe: the database sorts the enum this way, so "most severe" is max(risk). */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ASSESSMENT_STATUSES = [
  'STARTING',
  'RUNNING',
  'AGGREGATING',
  'AWAITING_APPROVAL',
  'PERSISTING',
  'COMPLETED',
  'REJECTED',
  'REJECTED_INPUT',
  'CANCELLED',
  'FAILED',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const TERMINAL_STATUSES = [
  'COMPLETED',
  'REJECTED',
  'REJECTED_INPUT',
  'CANCELLED',
  'FAILED',
] as const satisfies readonly AssessmentStatus[];

/** FAILED: the agent said so. LOST: we gave up on it. STOPPED: stopped by a cancel. */
export const AGENT_STATUSES = [
  'QUEUED',
  'STARTING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'LOST',
  'STOPPED',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const LOST_REASONS = ['START_FAILED', 'NOT_FOUND', 'NO_PROGRESS', 'CEILING'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const DECISIONS = ['APPROVE', 'REJECT'] as const;
export type Decision = (typeof DECISIONS)[number];
