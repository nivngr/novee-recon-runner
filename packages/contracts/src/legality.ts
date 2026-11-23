import type { AssessmentStatus } from './vocabulary.js';

// The legality table (plan §4). Enforced three times: the API (409), the database write (conditional
// update) and the workflow's signal handlers (ignore). One definition, so the three can't disagree.

export const RUN_ACTIONS = ['approve', 'reject', 'cancel', 'setWindow'] as const;
export type RunAction = (typeof RUN_ACTIONS)[number];

export const LEGAL_STATUSES: Readonly<Record<RunAction, readonly AssessmentStatus[]>> = {
  approve: ['AWAITING_APPROVAL'],
  reject: ['AWAITING_APPROVAL'],
  setWindow: ['STARTING', 'RUNNING'],
  cancel: ['STARTING', 'RUNNING', 'AGGREGATING', 'AWAITING_APPROVAL'],
};

export function isActionLegal(action: RunAction, status: AssessmentStatus): boolean {
  return LEGAL_STATUSES[action].includes(status);
}
