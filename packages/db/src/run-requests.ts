import { type Decision, LEGAL_STATUSES, TECHNIQUES } from '@novee/contracts';
import type { Assessment, PrismaClient } from './generated/prisma/client.js';
import type { CreateRunResult, NewRun } from './types.js';

/**
 * The API's writes: a submit, and the user's requests (cancel, decision, window). Each request is a
 * conditional update — legal status and no other request pending — so it returns whether it applied.
 */
export class RunRequests {
  constructor(private readonly prisma: PrismaClient) {}

  /** One transaction: the run and all its agent rows, or nothing. Safe to repeat (D12). */
  createRun(run: NewRun): Promise<CreateRunResult> {
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.assessment.createMany({
        data: [
          {
            id: run.id,
            targetDomain: run.domain,
            agentCount: run.agentCount,
            windowSize: run.windowSize,
            stallTimeoutS: run.stallTimeoutS,
            maxAgentDurationS: run.maxAgentDurationS,
            failFirstAttempts: run.failFirstAttempts,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        const existing = await tx.assessment.findUniqueOrThrow({ where: { id: run.id } });
        return isSameRequest(existing, run) ? 'existing' : 'conflict';
      }
      await tx.assessmentAgent.createMany({
        data: Array.from({ length: run.agentCount }, (_, agentIndex) => ({
          assessmentId: run.id,
          agentIndex,
          technique: TECHNIQUES[agentIndex % TECHNIQUES.length] ?? TECHNIQUES[0],
        })),
        skipDuplicates: true,
      });
      return 'created';
    });
  }

  async requestCancel(id: string): Promise<boolean> {
    const { count } = await this.prisma.assessment.updateMany({
      where: { id, status: { in: [...LEGAL_STATUSES.cancel] }, cancelRequestedAt: null, decision: null },
      data: { cancelRequestedAt: new Date() },
    });
    return count === 1;
  }

  /** First decision wins. */
  async requestDecision(id: string, decision: Decision): Promise<boolean> {
    const { count } = await this.prisma.assessment.updateMany({
      where: { id, status: { in: [...LEGAL_STATUSES.approve] }, cancelRequestedAt: null, decision: null },
      data: { decision, decisionRequestedAt: new Date() },
    });
    return count === 1;
  }

  /** `size` must be 1..agentCount; the row's own agent count is checked here. */
  async setWindow(id: string, size: number): Promise<boolean> {
    const { count } = await this.prisma.assessment.updateMany({
      where: {
        id,
        status: { in: [...LEGAL_STATUSES.setWindow] },
        cancelRequestedAt: null,
        agentCount: { gte: size },
      },
      data: { windowSize: size },
    });
    return count === 1;
  }
}

/** The window is left out: it can change after submit, so a repeated submit may carry the old one. */
function isSameRequest(existing: Assessment, run: NewRun): boolean {
  return (
    existing.targetDomain === run.domain &&
    existing.agentCount === run.agentCount &&
    existing.stallTimeoutS === run.stallTimeoutS &&
    existing.maxAgentDurationS === run.maxAgentDurationS &&
    existing.failFirstAttempts === run.failFirstAttempts
  );
}
