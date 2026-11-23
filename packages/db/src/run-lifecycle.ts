import { AssessmentStatus, RiskLevel, type RunFailure } from '@novee/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import type { RunSummary } from './types.js';

/** The workflow's writes to the run row: status moves, the summary, the approve. */
export class RunLifecycle {
  constructor(private readonly prisma: PrismaClient) {}

  /** Moves forward only from one of `from`. `false` means it had already moved on — never an error. */
  async setRunStatus(
    id: string,
    from: readonly AssessmentStatus[],
    to: AssessmentStatus,
    failure?: RunFailure,
  ): Promise<boolean> {
    const { count } = await this.prisma.assessment.updateMany({
      where: { id, status: { in: [...from] } },
      data: { status: to, failureCode: failure?.code, failureReason: failure?.detail },
    });
    return count === 1;
  }

  /** Counts each domain once, at the most severe risk any agent gave it; stores and returns the summary. */
  async aggregate(id: string): Promise<RunSummary> {
    const perDomain = await this.prisma.stagedDiscovery.groupBy({
      by: ['domain'],
      where: { assessmentId: id },
      _max: { risk: true },
    });
    const countAt = (risk: RiskLevel): number => perDomain.filter((group) => group._max.risk === risk).length;
    const summary: RunSummary = {
      uniqueDomains: perDomain.length,
      critical: countAt(RiskLevel.Critical),
      high: countAt(RiskLevel.High),
      medium: countAt(RiskLevel.Medium),
      low: countAt(RiskLevel.Low),
    };
    await this.prisma.assessment.update({
      where: { id },
      data: {
        uniqueDomains: summary.uniqueDomains,
        criticalCount: summary.critical,
        highCount: summary.high,
        mediumCount: summary.medium,
        lowCount: summary.low,
      },
    });
    return summary;
  }

  /**
   * One transaction: PERSISTING → COMPLETED, and only if that moved, copy the deduplicated staged findings
   * into the result table. A repeat finds the run already COMPLETED and writes nothing; the unique
   * (assessment_id, domain) constraint backs this up (R3).
   */
  approve(id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.assessment.updateMany({
        where: { id, status: AssessmentStatus.Persisting },
        data: { status: AssessmentStatus.Completed },
      });
      if (count === 0) return;
      await tx.$executeRaw`
        INSERT INTO discovered_domains (assessment_id, domain, risk)
        SELECT assessment_id, domain, max(risk)
        FROM staged_discoveries
        WHERE assessment_id = ${id}::uuid
        GROUP BY assessment_id, domain
        ON CONFLICT (assessment_id, domain) DO NOTHING`;
    });
  }
}
