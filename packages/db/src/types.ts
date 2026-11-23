import type {
  AgentStatus,
  DomainSource,
  FoundDomain,
  LostReason,
  RunSettings,
  StagedDomain,
} from '@novee/contracts';
import type { Prisma } from './generated/prisma/client.js';

/** What a submit asks for (validated by the API before it gets here). */
export interface NewRun {
  id: string;
  domain: string;
  agentCount: number;
  windowSize: number;
  settings: RunSettings;
}

/** `Existing`: the same request repeated. `Conflict`: the same id with different parameters. */
export const CreateRunResult = { Created: 'created', Existing: 'existing', Conflict: 'conflict' } as const;
export type CreateRunResult = (typeof CreateRunResult)[keyof typeof CreateRunResult];

export type RunRecord = Prisma.AssessmentGetPayload<{ include: { agents: true } }>;

/** One agent row, as stored. */
export type AgentRecord = RunRecord['agents'][number];

export type RunListItem = Prisma.AssessmentGetPayload<{
  select: { id: true; targetDomain: true; status: true; agentCount: true; createdAt: true };
}>;

/** One subdomain as one agent reported it (the same shape as a stored domain). */
export type Finding = FoundDomain;

/** Before approve: the deduplicated view of the staged findings. After: the stored result. */
export type DomainList =
  | { source: typeof DomainSource.Staged; domains: StagedDomain[] }
  | { source: typeof DomainSource.Final; domains: FoundDomain[] };

export interface RunSummary {
  uniqueDomains: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** How an agent ended, other than completing. */
export type AgentEnding =
  | { status: typeof AgentStatus.Failed }
  | {
      status: typeof AgentStatus.Lost;
      lostReason: typeof LostReason.StartFailed | typeof LostReason.NotFound;
    }
  | {
      status: typeof AgentStatus.Lost;
      lostReason: typeof LostReason.NoProgress | typeof LostReason.Ceiling;
      stopConfirmed: boolean;
    }
  | { status: typeof AgentStatus.Stopped; stopConfirmed: boolean };
