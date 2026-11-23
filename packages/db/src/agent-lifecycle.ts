import type { PrismaClient } from './generated/prisma/client.js';
import type { AgentEnding, Finding } from './types.js';

/**
 * The activities' writes to one agent row, addressed by (run id, agent index). Every update is conditional
 * on the status it moves from, so a retried activity changes nothing the first attempt already did.
 */
export class AgentLifecycle {
  constructor(private readonly prisma: PrismaClient) {}

  /** A retried start (possibly on another worker) stays STARTING and records the new worker. */
  async setAgentStarting(runId: string, index: number, worker: string): Promise<void> {
    await this.prisma.assessmentAgent.updateMany({
      where: { assessmentId: runId, agentIndex: index, status: { in: ['QUEUED', 'STARTING'] } },
      data: { status: 'STARTING', worker },
    });
  }

  async setAgentRunning(runId: string, index: number, scanId: string): Promise<void> {
    await this.prisma.assessmentAgent.updateMany({
      where: { assessmentId: runId, agentIndex: index, status: 'STARTING' },
      data: { status: 'RUNNING', scanId, startedAt: new Date() },
    });
  }

  /** Written on every poll; the caller treats a failure as best-effort. */
  async recordProgress(runId: string, index: number, progress: number, worker: string): Promise<void> {
    await this.prisma.assessmentAgent.updateMany({
      where: { assessmentId: runId, agentIndex: index, status: 'RUNNING' },
      data: { progress, worker },
    });
  }

  /**
   * One transaction: RUNNING → COMPLETED, and only if that moved, stage the findings. A repeat finds the
   * agent already COMPLETED and writes nothing; the staging primary key backs this up (R3).
   */
  completeAgent(runId: string, index: number, findings: readonly Finding[]): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.assessmentAgent.updateMany({
        where: { assessmentId: runId, agentIndex: index, status: 'RUNNING' },
        data: { status: 'COMPLETED', progress: 1, discoveredCount: findings.length, finishedAt: new Date() },
      });
      if (count === 0) return;
      await tx.stagedDiscovery.createMany({
        data: findings.map((finding) => ({ assessmentId: runId, agentIndex: index, ...finding })),
        skipDuplicates: true,
      });
    });
  }

  /** Ends an agent that hasn't ended yet; an agent that already ended keeps its first ending. */
  async endAgent(runId: string, index: number, ending: AgentEnding): Promise<void> {
    await this.prisma.assessmentAgent.updateMany({
      where: { assessmentId: runId, agentIndex: index, status: { in: ['QUEUED', 'STARTING', 'RUNNING'] } },
      data: {
        status: ending.status,
        lostReason: ending.status === 'LOST' ? ending.lostReason : null,
        stopConfirmed: 'stopConfirmed' in ending ? ending.stopConfirmed : null,
        finishedAt: new Date(),
      },
    });
  }
}
