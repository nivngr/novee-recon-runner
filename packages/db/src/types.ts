import type { RiskLevel } from '@novee/contracts';
import type { Prisma } from './generated/prisma/client.js';

/** What a submit asks for (validated by the API before it gets here). */
export interface NewRun {
  id: string;
  domain: string;
  agentCount: number;
  windowSize: number;
  stallTimeoutS: number;
  maxAgentDurationS: number;
  failFirstAttempts: number;
}

/** `existing`: the same request repeated. `conflict`: the same id with different parameters. */
export type CreateRunResult = 'created' | 'existing' | 'conflict';

export type RunRecord = Prisma.AssessmentGetPayload<{ include: { agents: true } }>;

export type RunListItem = Prisma.AssessmentGetPayload<{
  select: { id: true; targetDomain: true; status: true; agentCount: true; createdAt: true };
}>;

/** One subdomain as one agent reported it. */
export interface Finding {
  domain: string;
  risk: RiskLevel;
}

export interface StagedDomain {
  domain: string;
  /** The most severe rating any agent gave it. */
  risk: RiskLevel;
  /** How many agents reported it. */
  foundBy: number;
}

/** Before approve: the deduplicated view of the staged findings. After: the stored result. */
export type DomainList =
  | { source: 'staged'; domains: StagedDomain[] }
  | { source: 'final'; domains: Finding[] };

export interface RunSummary {
  uniqueDomains: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** How an agent ended, other than completing. */
export type AgentEnding =
  | { status: 'FAILED' }
  | { status: 'LOST'; lostReason: 'START_FAILED' | 'NOT_FOUND' }
  | { status: 'LOST'; lostReason: 'NO_PROGRESS' | 'CEILING'; stopConfirmed: boolean }
  | { status: 'STOPPED'; stopConfirmed: boolean };
