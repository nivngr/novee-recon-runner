import type { AgentStatus, AssessmentStatus, LostReason, RunFailure, Technique } from '@novee/contracts';

// Activity inputs and outputs: small values only, never bulk results (R4).

interface Injectable {
  failFirstAttempts: number;
}

interface AgentRef extends Injectable {
  runId: string;
  index: number;
}

export interface StartAgentInput extends AgentRef {
  domain: string;
  technique: Technique;
}

export interface WaitAgentInput extends AgentRef {
  scanId: string;
  stallTimeoutS: number;
  maxAgentDurationS: number;
}

/** How waitAgent's watch ended. NoProgress and Ceiling mean "give up": the workflow then stops the agent. */
export const WaitOutcome = {
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  NotFound: 'NOT_FOUND',
  NoProgress: 'NO_PROGRESS',
  Ceiling: 'CEILING',
  Stopped: 'STOPPED',
} as const;
export type WaitOutcome = (typeof WaitOutcome)[keyof typeof WaitOutcome];

export type WaitResult =
  | { outcome: typeof WaitOutcome.Completed; discoveredCount: number }
  | { outcome: Exclude<WaitOutcome, typeof WaitOutcome.Completed> };

/** The reasons we give up on a running agent; the same values as the matching LostReason. */
export type GiveUpReason = typeof LostReason.NoProgress | typeof LostReason.Ceiling;

/** How a stopped agent should be recorded: lost (we gave up on it) or stopped (by a cancel). */
export type StopReason =
  | { status: typeof AgentStatus.Stopped }
  | { status: typeof AgentStatus.Lost; lostReason: GiveUpReason };

export interface StopAgentInput extends AgentRef {
  scanId: string;
  endAs: StopReason;
}

export interface MarkStopUnconfirmedInput extends AgentRef {
  endAs: StopReason;
}

export type MarkStartFailedInput = AgentRef;

export interface SetRunStatusInput extends Injectable {
  runId: string;
  from: readonly AssessmentStatus[];
  to: AssessmentStatus;
  failure?: RunFailure;
}

export interface RunRef extends Injectable {
  runId: string;
}

/** Carried in heartbeats so a retried waitAgent keeps the no-progress clock (D7, spike 05). */
export interface WaitProgress {
  lastProgress: number;
  lastChangeAt: number;
}
