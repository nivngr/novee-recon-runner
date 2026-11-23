import { AssessmentStatus, LIVE_STATUSES, type RunView } from '@novee/contracts';

export const FAST_POLL_MS = 1_000;
export const SLOW_POLL_MS = 5_000;

/**
 * How often the run page polls (D11): every second while something is moving or a request is pending, every 5s
 * while waiting for a human, never again once the run has ended.
 */
export function runPollInterval(view: RunView | undefined): number | false {
  if (view === undefined) return FAST_POLL_MS;
  if (!LIVE_STATUSES.includes(view.status)) return false;
  if (view.pending !== null) return FAST_POLL_MS;
  return view.status === AssessmentStatus.AwaitingApproval ? SLOW_POLL_MS : FAST_POLL_MS;
}
