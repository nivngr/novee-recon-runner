import { AgentStatus, agentKeyFor, LostReason } from '@novee/contracts';
import type { AgentEnding, AgentLifecycle } from '@novee/db';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { z } from 'zod';
import { type AgentServiceClient, type Scan, ScanStatus } from '../agent-service/agent-service-client.js';
import { StartVerdict } from '../agent-service/classify.js';
import { FailureType } from './failure-types.js';
import { failIfInjected } from './failures.js';
import type {
  MarkStartFailedInput,
  MarkStopUnconfirmedInput,
  StartAgentInput,
  StopAgentInput,
  StopReason,
  WaitAgentInput,
  WaitProgress,
  WaitResult,
} from './types.js';
import { WaitOutcome } from './types.js';

const POLL_INTERVAL_MS = 1_000;

/** agent-service couldn't be reached on this poll (as opposed to `null`: it answered that the scan is unknown). */
const UNREACHABLE = Symbol('agent-service unreachable');

const WaitProgressSchema = z.object({ lastProgress: z.number(), lastChangeAt: z.number() });

/** One agent's life: start it, watch it to the end, stop it. Each activity is safe to repeat. */
export class AgentActivities {
  // `#` fields: the worker registers this object's own properties as activities, and these aren't.
  readonly #agentService: AgentServiceClient;
  readonly #agents: AgentLifecycle;
  /** This worker's pod name, recorded on the agent row. */
  readonly #workerName: string;

  constructor(agentService: AgentServiceClient, agents: AgentLifecycle, workerName: string) {
    this.#agentService = agentService;
    this.#agents = agents;
    this.#workerName = workerName;
  }

  /** Returns the scan id. The idempotency key makes a retried start return the same agent (R3). */
  startAgent = async (input: StartAgentInput): Promise<string> => {
    await this.#agents.setAgentStarting(input.runId, input.index, this.#workerName);
    const result = await this.#agentService.startScan(
      input.domain,
      input.technique,
      agentKeyFor(input.runId, input.index),
    );
    switch (result.verdict) {
      case StartVerdict.Started:
        await this.#agents.setAgentRunning(input.runId, input.index, result.scanId);
        failIfInjected(input.failFirstAttempts);
        return result.scanId;
      case StartVerdict.UnsupportedDomain:
        throw ApplicationFailure.nonRetryable(
          `agent-service does not support ${input.domain}`,
          FailureType.UnsupportedDomain,
        );
      case StartVerdict.BadRequest:
        throw ApplicationFailure.nonRetryable(
          `agent-service rejected the request: ${result.body}`,
          FailureType.BadRequest,
        );
      case StartVerdict.Retryable:
        throw ApplicationFailure.retryable(
          `agent-service answered HTTP ${result.status}`,
          FailureType.AgentServiceUnavailable,
        );
    }
  };

  /** Polls every second until the agent ends or we give up on it; heartbeats are the lease (D3, D7). */
  waitAgent = async (input: WaitAgentInput): Promise<WaitResult> => {
    const outcome = await this.#watch(input);
    failIfInjected(input.failFirstAttempts);
    return outcome;
  };

  /** Stops the scan (404 = nothing to stop), then records how the agent ended. */
  stopAgent = async (input: StopAgentInput): Promise<void> => {
    await this.#agentService.stopScan(input.scanId);
    await this.#agents.endAgent(input.runId, input.index, endingFor(input.endAs, true));
    failIfInjected(input.failFirstAttempts);
  };

  /** After stopAgent gave up: the agent still ends, flagged "stop unconfirmed" (D6). */
  markStopUnconfirmed = async (input: MarkStopUnconfirmedInput): Promise<void> => {
    await this.#agents.endAgent(input.runId, input.index, endingFor(input.endAs, false));
    failIfInjected(input.failFirstAttempts);
  };

  markStartFailed = async (input: MarkStartFailedInput): Promise<void> => {
    await this.#agents.endAgent(input.runId, input.index, {
      status: AgentStatus.Lost,
      lostReason: LostReason.StartFailed,
    });
    failIfInjected(input.failFirstAttempts);
  };

  async #watch(input: WaitAgentInput): Promise<WaitResult> {
    const context = Context.current();
    // A retried attempt continues the previous attempt's no-progress clock instead of restarting it.
    const carried = WaitProgressSchema.safeParse(context.info.heartbeatDetails);
    let progress: WaitProgress = carried.success
      ? carried.data
      : { lastProgress: -1, lastChangeAt: Date.now() };
    let startedAt: number | undefined;

    for (;;) {
      const scan = await this.#tryGetScan(input.scanId);
      if (scan === null) {
        await this.#agents.endAgent(input.runId, input.index, {
          status: AgentStatus.Lost,
          lostReason: LostReason.NotFound,
        });
        return { outcome: WaitOutcome.NotFound };
      }
      if (scan !== UNREACHABLE) {
        const ended = await this.#recordIfEnded(input, scan);
        if (ended !== undefined) return ended;
        startedAt = Date.parse(scan.startedAt);
        if (scan.progress !== progress.lastProgress) {
          progress = { lastProgress: scan.progress, lastChangeAt: Date.now() };
        }
        await this.#recordProgress(input, scan.progress);
      }

      context.heartbeat(progress);
      const now = Date.now();
      if (now - progress.lastChangeAt >= input.stallTimeoutS * 1000)
        return { outcome: WaitOutcome.NoProgress };
      if (startedAt !== undefined && now - startedAt >= input.maxAgentDurationS * 1000) {
        return { outcome: WaitOutcome.Ceiling };
      }
      await context.sleep(POLL_INTERVAL_MS); // throws if the activity is cancelled
    }
  }

  /** If the scan has ended, records how and returns the result; `undefined` while it's still running. */
  async #recordIfEnded(input: WaitAgentInput, scan: Scan): Promise<WaitResult | undefined> {
    switch (scan.status) {
      case ScanStatus.Completed: {
        const findings = scan.discovered ?? [];
        await this.#agents.completeAgent(input.runId, input.index, findings);
        return { outcome: WaitOutcome.Completed, discoveredCount: findings.length };
      }
      case ScanStatus.Failed:
        await this.#agents.endAgent(input.runId, input.index, { status: AgentStatus.Failed });
        return { outcome: WaitOutcome.Failed };
      case ScanStatus.Stopped:
        await this.#agents.endAgent(input.runId, input.index, {
          status: AgentStatus.Stopped,
          stopConfirmed: true,
        });
        return { outcome: WaitOutcome.Stopped };
      case ScanStatus.Running:
        return undefined;
    }
  }

  /** A network error is logged and reported as UNREACHABLE: the loop polls again, and only the stall checks end it. */
  async #tryGetScan(scanId: string): Promise<Scan | null | typeof UNREACHABLE> {
    try {
      return await this.#agentService.getScan(scanId);
    } catch (error) {
      Context.current().log.warn('poll failed; retrying in 1s', { scanId, error: String(error) });
      return UNREACHABLE;
    }
  }

  /** Best-effort: a failed progress write is logged, never fatal. */
  async #recordProgress(input: WaitAgentInput, progress: number): Promise<void> {
    try {
      await this.#agents.recordProgress(input.runId, input.index, progress, this.#workerName);
    } catch (error) {
      Context.current().log.warn('recordProgress failed', {
        runId: input.runId,
        index: input.index,
        error: String(error),
      });
    }
  }
}

function endingFor(endAs: StopReason, stopConfirmed: boolean): AgentEnding {
  return endAs.status === AgentStatus.Stopped
    ? { status: AgentStatus.Stopped, stopConfirmed }
    : { status: AgentStatus.Lost, lostReason: endAs.lostReason, stopConfirmed };
}
