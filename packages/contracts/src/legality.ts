import { AssessmentStatus } from './vocabulary.js';

// The legality table (plan §4). Enforced three times: the API (409), the database write (conditional
// update) and the workflow's signal handlers (ignore). One definition, so the three can't disagree.

export const RunAction = {
  Approve: 'approve',
  Reject: 'reject',
  Cancel: 'cancel',
  SetWindow: 'setWindow',
} as const;
export type RunAction = (typeof RunAction)[keyof typeof RunAction];

export const LEGAL_STATUSES: Readonly<Record<RunAction, readonly AssessmentStatus[]>> = {
  [RunAction.Approve]: [AssessmentStatus.AwaitingApproval],
  [RunAction.Reject]: [AssessmentStatus.AwaitingApproval],
  [RunAction.SetWindow]: [AssessmentStatus.Starting, AssessmentStatus.Running],
  // Cancel means "stop the agents": only while agents can be running. Once a run awaits a decision, it's approve
  // or reject (reject stores nothing, the same outcome under the honest name).
  [RunAction.Cancel]: [AssessmentStatus.Starting, AssessmentStatus.Running],
};

export function isActionLegal(action: RunAction, status: AssessmentStatus): boolean {
  return LEGAL_STATUSES[action].includes(status);
}
