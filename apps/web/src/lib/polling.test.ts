import { AssessmentStatus, PendingRequest, type RunView } from '@novee/contracts';
import { describe, expect, it } from 'vitest';
import { FAST_POLL_MS, runPollInterval, SLOW_POLL_MS } from './polling.js';

const view = (status: AssessmentStatus, pending: PendingRequest | null = null): RunView => ({
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  domain: 'example.com',
  agentCount: 1,
  window: 1,
  status,
  pending,
  counts: { queued: 0, running: 0, completed: 0, failed: 0, lost: 0, stopped: 0 },
  summary: null,
  agents: [],
  allowedActions: [],
  failure: null,
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
});

describe('runPollInterval', () => {
  it('polls every second until the first answer and while agents run', () => {
    expect(runPollInterval(undefined)).toBe(FAST_POLL_MS);
    expect(runPollInterval(view(AssessmentStatus.Running))).toBe(FAST_POLL_MS);
    expect(runPollInterval(view(AssessmentStatus.Persisting))).toBe(FAST_POLL_MS);
  });

  it('slows down while waiting for a human, speeds up once a decision is pending', () => {
    expect(runPollInterval(view(AssessmentStatus.AwaitingApproval))).toBe(SLOW_POLL_MS);
    expect(runPollInterval(view(AssessmentStatus.AwaitingApproval, PendingRequest.Approving))).toBe(
      FAST_POLL_MS,
    );
  });

  it('stops at every terminal status', () => {
    for (const status of [
      AssessmentStatus.Completed,
      AssessmentStatus.Rejected,
      AssessmentStatus.RejectedInput,
      AssessmentStatus.Cancelled,
      AssessmentStatus.Failed,
    ]) {
      expect(runPollInterval(view(status))).toBe(false);
    }
  });
});
