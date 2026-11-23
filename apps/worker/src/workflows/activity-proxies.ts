import type { ReconInput } from '@novee/contracts';
import { type ActivityOptions, proxyActivities } from '@temporalio/workflow';
import type { AgentActivities } from '../activities/agent-activities.js';
import { FailureType } from '../activities/failure-types.js';
import type { RunActivities } from '../activities/run-activities.js';

// Activity options (plan §3). waitAgent's time limit depends on the run, so proxies are built per run.

const RETRY = { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '10s' } as const;

const START: ActivityOptions = {
  startToCloseTimeout: '10s',
  scheduleToCloseTimeout: '2m', // then the agent is lost: START_FAILED
  retry: { ...RETRY, nonRetryableErrorTypes: [FailureType.UnsupportedDomain, FailureType.BadRequest] },
};

const STOP: ActivityOptions = {
  startToCloseTimeout: '10s',
  scheduleToCloseTimeout: '5m', // then "stop unconfirmed"
  retry: RETRY,
};

const DATABASE: ActivityOptions = { startToCloseTimeout: '10s', retry: { ...RETRY, maximumInterval: '5s' } };

export function activitiesFor(input: ReconInput) {
  const { startAgent } = proxyActivities<AgentActivities>(START);
  const { waitAgent } = proxyActivities<AgentActivities>({
    startToCloseTimeout: (input.maxAgentDurationS + 60) * 1000,
    heartbeatTimeout: '10s', // the lease: a dead worker's poll is retried elsewhere within ~10s
    retry: RETRY,
  });
  const { stopAgent } = proxyActivities<AgentActivities>(STOP);
  const { markStartFailed, markStopUnconfirmed } = proxyActivities<AgentActivities>(DATABASE);
  const { setRunStatus, aggregate, persist } = proxyActivities<RunActivities>(DATABASE);
  return {
    startAgent,
    waitAgent,
    stopAgent,
    markStartFailed,
    markStopUnconfirmed,
    setRunStatus,
    aggregate,
    persist,
  };
}

export type ReconActivities = ReturnType<typeof activitiesFor>;
