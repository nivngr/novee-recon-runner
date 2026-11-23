import { AssessmentStatus, DomainSource, type StagedDomain } from '@novee/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import type { DomainList, RunListItem, RunRecord } from './types.js';

/** Read-only queries behind the API's GET endpoints. */
export class RunReader {
  constructor(private readonly prisma: PrismaClient) {}

  getRun(id: string): Promise<RunRecord | null> {
    return this.prisma.assessment.findUnique({
      where: { id },
      include: { agents: { orderBy: { agentIndex: 'asc' } } },
    });
  }

  listRuns(limit: number): Promise<RunListItem[]> {
    return this.prisma.assessment.findMany({
      select: { id: true, targetDomain: true, status: true, agentCount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Sorted most severe first, then by name. `null` if the run doesn't exist. */
  async getDomains(id: string): Promise<DomainList | null> {
    const run = await this.prisma.assessment.findUnique({ where: { id }, select: { status: true } });
    if (run === null) return null;
    if (run.status === AssessmentStatus.Completed) {
      const domains = await this.prisma.discoveredDomain.findMany({
        where: { assessmentId: id },
        select: { domain: true, risk: true },
        orderBy: [{ risk: 'desc' }, { domain: 'asc' }],
      });
      return { source: DomainSource.Final, domains };
    }
    return { source: DomainSource.Staged, domains: await this.stagedDomains(id) };
  }

  private async stagedDomains(id: string): Promise<StagedDomain[]> {
    const groups = await this.prisma.stagedDiscovery.groupBy({
      by: ['domain'],
      where: { assessmentId: id },
      _max: { risk: true },
      _count: { agentIndex: true },
      orderBy: [{ _max: { risk: 'desc' } }, { domain: 'asc' }],
    });
    return groups.flatMap((group) =>
      // Every group has at least one row, so max(risk) is never null; flatMap keeps the type honest.
      group._max.risk === null
        ? []
        : [{ domain: group.domain, risk: group._max.risk, foundBy: group._count.agentIndex }],
    );
  }
}
