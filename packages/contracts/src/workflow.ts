import type { RunSettings } from './api.js';
import type { AssessmentStatus } from './vocabulary.js';

// The recon workflow's public surface: what the API needs to start and signal it without importing worker code.

export const WORKFLOW_TYPE = 'recon';

export function workflowIdFor(runId: string): string {
  return `assessment-${runId}`;
}

/** The agent-service idempotency key: one per (run, agent), so a retried start never launches a second agent. */
export function agentKeyFor(runId: string, agentIndex: number): string {
  return `${runId}-agent-${agentIndex}`;
}

export interface ReconInput {
  runId: string;
  domain: string;
  agentCount: number;
  windowSize: number;
  settings: RunSettings;
}

/** The workflow's signal names. */
export const Signal = { SetWindow: 'setWindow', Approve: 'approve', Reject: 'reject' } as const;
export type Signal = (typeof Signal)[keyof typeof Signal];

/** The status a workflow that ended normally finished in. Cancellation and real errors end it otherwise. */
export type ReconResult =
  | typeof AssessmentStatus.Completed
  | typeof AssessmentStatus.Rejected
  | typeof AssessmentStatus.RejectedInput
  | typeof AssessmentStatus.Failed;
