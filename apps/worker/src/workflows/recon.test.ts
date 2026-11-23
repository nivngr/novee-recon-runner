// Workflow tests (plan §9): the real workflow in Temporal's time-skipping test server, with fake activities
// that record what the workflow asked for.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AssessmentStatus, type ReconInput, type ReconResult, Signal, WORKFLOW_TYPE } from '@novee/contracts';
import type { RunSummary } from '@novee/db';
import { Context } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { historyFromJSON } from '@temporalio/common/proto-utils';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker, type WorkerOptions } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentActivities } from '../activities/agent-activities.js';
import { FailureType } from '../activities/failure-types.js';
import type { RunActivities } from '../activities/run-activities.js';
import { WaitOutcome, type WaitResult } from '../activities/types.js';

type Activities = Pick<AgentActivities, keyof AgentActivities> & Pick<RunActivities, keyof RunActivities>;

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** How a fake agent behaves once started. */
type AgentScript =
  | { kind: 'finishes'; afterMs: number; outcome?: WaitResult }
  | { kind: 'runsUntilCancelled' };

/** Fake activities: record every call, and track how many agents are in flight. */
class FakeActivities {
  readonly statuses: AssessmentStatus[] = [];
  readonly events: string[] = [];
  readonly stops: number[] = [];
  readonly startFailures: number[] = [];
  persisted = 0;
  inFlight = 0;
  maxInFlight = 0;

  constructor(
    private readonly script: (index: number) => AgentScript,
    private readonly startError?: Error,
  ) {}

  activities(): Activities {
    return {
      startAgent: async ({ index }) => {
        this.events.push(`start ${index}`);
        if (this.startError !== undefined) throw this.startError;
        return `scan-${index}`;
      },
      waitAgent: async ({ index }) => {
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
          const script = this.script(index);
          if (script.kind === 'runsUntilCancelled') {
            for (;;) {
              Context.current().heartbeat();
              await Context.current().sleep(50); // throws once the workflow cancels this activity
            }
          }
          await new Promise((resolve) => setTimeout(resolve, script.afterMs));
          this.events.push(`end ${index}`);
          return script.outcome ?? { outcome: WaitOutcome.Completed, discoveredCount: 3 };
        } finally {
          this.inFlight -= 1;
        }
      },
      stopAgent: async ({ index }) => {
        this.stops.push(index);
      },
      markStopUnconfirmed: async () => {},
      markStartFailed: async ({ index }) => {
        this.startFailures.push(index);
      },
      setRunStatus: async ({ to }) => {
        this.statuses.push(to);
        return true;
      },
      aggregate: async (): Promise<RunSummary> => ({
        uniqueDomains: 3,
        critical: 1,
        high: 1,
        medium: 1,
        low: 0,
      }),
      persist: async () => {
        this.persisted += 1;
      },
    };
  }

  /** Resolves once the workflow has written `status`. */
  async reached(status: AssessmentStatus): Promise<void> {
    while (!this.statuses.includes(status)) await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Bundle our packages from source, never a stale dist/. Keeps Temporal's own aliases: they block I/O. */
const BUNDLE_FROM_SOURCE: NonNullable<WorkerOptions['bundlerOptions']> = {
  webpackConfigHook: (config) => {
    const alias = config.resolve?.alias;
    if (alias === undefined || Array.isArray(alias))
      throw new Error("unexpected shape of Temporal's bundler config");
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...alias, '@novee/contracts': source('../../../../packages/contracts/src/index.ts') },
      },
    };
  },
};

let env: TestWorkflowEnvironment;
let runCount = 0;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

function inputFor(overrides: Partial<ReconInput> = {}): ReconInput {
  runCount += 1;
  return {
    runId: `00000000-0000-0000-0000-${String(runCount).padStart(12, '0')}`,
    domain: 'example.com',
    agentCount: 6,
    windowSize: 2,
    settings: { stallTimeoutS: 60, maxAgentDurationS: 300, failFirstAttempts: 0 },
    ...overrides,
  };
}

/** Runs one workflow on a fresh worker; `drive` interacts with it while it runs. */
async function runRecon(
  fakes: FakeActivities,
  input: ReconInput,
  drive: (handle: Awaited<ReturnType<typeof env.client.workflow.start>>) => Promise<void>,
): Promise<ReconResult> {
  const taskQueue = `test-${input.runId}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: source('./index.ts'),
    activities: fakes.activities(),
    bundlerOptions: BUNDLE_FROM_SOURCE,
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(WORKFLOW_TYPE, {
      taskQueue,
      workflowId: `assessment-${input.runId}`,
      args: [input],
    });
    await drive(handle);
    return (await handle.result()) as ReconResult;
  });
}

const approveWhenAsked =
  (fakes: FakeActivities) => async (handle: { signal: (name: string) => Promise<void> }) => {
    await fakes.reached(AssessmentStatus.AwaitingApproval);
    await handle.signal(Signal.Approve);
  };

describe('recon workflow', { timeout: 60_000 }, () => {
  it('window: never more than 2 in flight, and a slot is refilled as soon as one agent ends', async () => {
    // Agent 1 is slow: agent 2 must start when agent 0 ends, not wait for both.
    const fakes = new FakeActivities((index) => ({ kind: 'finishes', afterMs: index === 1 ? 600 : 100 }));

    const result = await runRecon(fakes, inputFor(), approveWhenAsked(fakes));

    expect(result).toBe(AssessmentStatus.Completed);
    expect(fakes.maxInFlight).toBe(2);
    expect(fakes.events.indexOf('start 2')).toBeGreaterThan(fakes.events.indexOf('end 0'));
    expect(fakes.events.indexOf('start 2')).toBeLessThan(fakes.events.indexOf('end 1'));
    expect(fakes.statuses).toEqual([
      AssessmentStatus.Running,
      AssessmentStatus.Aggregating,
      AssessmentStatus.AwaitingApproval,
      AssessmentStatus.Persisting,
    ]);
    expect(fakes.persisted).toBe(1);
  });

  it('resize: raising the window reaches 4; lowering it starts nothing new and stops nothing', async () => {
    const fakes = new FakeActivities(() => ({ kind: 'finishes', afterMs: 300 }));

    const result = await runRecon(fakes, inputFor({ windowSize: 1 }), async (handle) => {
      while (!fakes.events.includes('start 0')) await new Promise((resolve) => setTimeout(resolve, 10));
      await handle.signal(Signal.SetWindow, 4);
      while (fakes.inFlight < 4) await new Promise((resolve) => setTimeout(resolve, 10));
      await handle.signal(Signal.SetWindow, 1);
      await approveWhenAsked(fakes)(handle);
    });

    expect(result).toBe(AssessmentStatus.Completed);
    expect(fakes.maxInFlight).toBe(4);
    expect(fakes.stops).toEqual([]);
    expect(fakes.events.filter((event) => event.startsWith('end'))).toHaveLength(6);
  });

  it('cancel: both agents in flight are stopped, nothing else starts, the run ends CANCELLED', async () => {
    const fakes = new FakeActivities(() => ({ kind: 'runsUntilCancelled' }));

    const outcome = runRecon(fakes, inputFor({ agentCount: 4 }), async (handle) => {
      while (fakes.inFlight < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      await handle.cancel();
    });

    const error = await outcome.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkflowFailedError);
    expect((error as WorkflowFailedError).cause).toBeInstanceOf(CancelledFailure);
    expect(fakes.stops.sort()).toEqual([0, 1]);
    expect(fakes.events).toEqual(['start 0', 'start 1']);
    expect(fakes.statuses.at(-1)).toBe(AssessmentStatus.Cancelled);
  });

  it('bad domain: exactly one start, then REJECTED_INPUT', async () => {
    const unsupported = ApplicationFailure.nonRetryable('unsupported', FailureType.UnsupportedDomain);
    const fakes = new FakeActivities(() => ({ kind: 'finishes', afterMs: 10 }), unsupported);

    const result = await runRecon(fakes, inputFor({ domain: 'example.invalid' }), async () => {});

    expect(result).toBe(AssessmentStatus.RejectedInput);
    expect(fakes.events).toEqual(['start 0']);
    expect(fakes.startFailures).toEqual([0]);
    expect(fakes.statuses).toEqual([AssessmentStatus.Running, AssessmentStatus.RejectedInput]);
  });

  it('reject: ends REJECTED and persists nothing', async () => {
    const fakes = new FakeActivities(() => ({ kind: 'finishes', afterMs: 10 }));

    const result = await runRecon(fakes, inputFor({ agentCount: 2 }), async (handle) => {
      await fakes.reached(AssessmentStatus.AwaitingApproval);
      await handle.signal(Signal.Reject);
      await handle.signal(Signal.Approve); // too late: the first decision wins
    });

    expect(result).toBe(AssessmentStatus.Rejected);
    expect(fakes.persisted).toBe(0);
  });

  it('no agent completed: the run ends FAILED without asking for a decision', async () => {
    const fakes = new FakeActivities(() => ({
      kind: 'finishes',
      afterMs: 10,
      outcome: { outcome: WaitOutcome.Failed },
    }));

    const result = await runRecon(fakes, inputFor({ agentCount: 3 }), async () => {});

    expect(result).toBe(AssessmentStatus.Failed);
    expect(fakes.statuses).toEqual([AssessmentStatus.Running, AssessmentStatus.Failed]);
  });
});

describe('replay', { timeout: 60_000 }, () => {
  // Each fixture is a real run recorded with a version of the code whose runs may still be in flight. A failing
  // replay means the change would break them (A4). Retire a fixture only with its compatibility code (apps/worker/CLAUDE.md).
  it.each([['recon-history.json', 'settings nested (M5 on)']])(
    '%s — a real run (%s) replays against the current code',
    async (fixture) => {
      // Record a new fixture with scripts/record-history.ts.
      const history = historyFromJSON(JSON.parse(await readFile(source(`./fixtures/${fixture}`), 'utf8')));
      await Worker.runReplayHistory(
        { workflowsPath: source('./index.ts'), bundlerOptions: BUNDLE_FROM_SOURCE },
        history,
      );
    },
  );
});
