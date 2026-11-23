// Database tests (plan §9): run by `task test:db` against a throwaway Postgres with the migrations applied.
import { randomUUID } from 'node:crypto';
import {
  AgentStatus,
  AssessmentStatus,
  Decision,
  DomainSource,
  LostReason,
  RiskLevel,
} from '@novee/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentLifecycle } from './agent-lifecycle.js';
import { createPrismaClient } from './client.js';
import { RunLifecycle } from './run-lifecycle.js';
import { RunReader } from './run-reader.js';
import { RunRequests } from './run-requests.js';
import { CreateRunResult, type Finding, type NewRun } from './types.js';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL is not set: run these with `task test:db`');

const prisma = createPrismaClient(databaseUrl);
const requests = new RunRequests(prisma);
const reader = new RunReader(prisma);
const runs = new RunLifecycle(prisma);
const agents = new AgentLifecycle(prisma);

afterAll(() => prisma.$disconnect());

function newRun(overrides: Partial<NewRun> = {}): NewRun {
  return {
    id: randomUUID(),
    domain: 'example.com',
    agentCount: 3,
    windowSize: 2,
    settings: { stallTimeoutS: 60, maxAgentDurationS: 300, failFirstAttempts: 0 },
    ...overrides,
  };
}

async function startAgent(runId: string, index: number): Promise<void> {
  await agents.setAgentStarting(runId, index, 'worker-a');
  await agents.setAgentRunning(runId, index, `scan-${index}`);
}

/** Three agents; a.example is reported by all three at different risks, b.example by two. */
const FINDINGS: readonly (readonly Finding[])[] = [
  [
    { domain: 'a.example.com', risk: RiskLevel.Low },
    { domain: 'b.example.com', risk: RiskLevel.High },
  ],
  [
    { domain: 'a.example.com', risk: RiskLevel.Medium },
    { domain: 'c.example.com', risk: RiskLevel.Critical },
  ],
  [
    { domain: 'a.example.com', risk: RiskLevel.Low },
    { domain: 'b.example.com', risk: RiskLevel.Low },
  ],
];

/** A run whose three agents completed with FINDINGS, now AGGREGATING. */
async function runWithFindings(): Promise<string> {
  const run = newRun();
  await requests.createRun(run);
  await runs.setRunStatus(run.id, [AssessmentStatus.Starting], AssessmentStatus.Running);
  for (const [index, findings] of FINDINGS.entries()) {
    await startAgent(run.id, index);
    await agents.completeAgent(run.id, index, findings);
  }
  await runs.setRunStatus(run.id, [AssessmentStatus.Running], AssessmentStatus.Aggregating);
  return run.id;
}

describe('createRun', () => {
  it('creates the run and all agent rows once; a repeat is "existing", different parameters "conflict"', async () => {
    const run = newRun({ agentCount: 5 });

    expect(await requests.createRun(run)).toBe(CreateRunResult.Created);
    expect(await requests.createRun(run)).toBe(CreateRunResult.Existing);
    expect(await requests.createRun({ ...run, windowSize: 3 })).toBe(CreateRunResult.Existing);
    expect(await requests.createRun({ ...run, agentCount: 6 })).toBe(CreateRunResult.Conflict);

    const stored = await reader.getRun(run.id);
    expect(stored?.status).toBe(AssessmentStatus.Starting);
    expect(stored?.agents.map((agent) => [agent.agentIndex, agent.technique, agent.status])).toEqual([
      [0, 'dns-brute', AgentStatus.Queued],
      [1, 'cert-transparency', AgentStatus.Queued],
      [2, 'passive-dns', AgentStatus.Queued],
      [3, 'web-crawl', AgentStatus.Queued],
      [4, 'dns-brute', AgentStatus.Queued],
    ]);
  });

  it('rejects values outside the allowed ranges at the database', async () => {
    await expect(requests.createRun(newRun({ agentCount: 3, windowSize: 4 }))).rejects.toThrow();
  });
});

describe('completeAgent', () => {
  it('called twice stages the findings once', async () => {
    const run = newRun();
    await requests.createRun(run);
    await startAgent(run.id, 0);
    const findings = FINDINGS[0] ?? [];

    await agents.completeAgent(run.id, 0, findings);
    await agents.completeAgent(run.id, 0, findings);

    const staged = await prisma.stagedDiscovery.findMany({ where: { assessmentId: run.id } });
    expect(staged.map((row) => row.domain).sort()).toEqual(['a.example.com', 'b.example.com']);
    const agent = (await reader.getRun(run.id))?.agents[0];
    expect([agent?.status, agent?.discoveredCount, agent?.progress]).toEqual([AgentStatus.Completed, 2, 1]);
  });

  it('stages nothing for an agent that already ended another way', async () => {
    const run = newRun();
    await requests.createRun(run);
    await startAgent(run.id, 0);
    await agents.endAgent(run.id, 0, { status: AgentStatus.Stopped, stopConfirmed: true });

    await agents.completeAgent(run.id, 0, FINDINGS[0] ?? []);

    expect(await prisma.stagedDiscovery.count({ where: { assessmentId: run.id } })).toBe(0);
    expect((await reader.getRun(run.id))?.agents[0]?.status).toBe(AgentStatus.Stopped);
  });
});

describe('aggregate', () => {
  it('counts each domain once, at its most severe risk', async () => {
    const id = await runWithFindings();

    const summary = await runs.aggregate(id);

    expect(summary).toEqual({ uniqueDomains: 3, critical: 1, high: 1, medium: 1, low: 0 });
    const stored = await reader.getRun(id);
    expect([stored?.uniqueDomains, stored?.criticalCount, stored?.lowCount]).toEqual([3, 1, 0]);
  });
});

describe('approve', () => {
  it('called twice stores each domain exactly once, at its most severe risk', async () => {
    const id = await runWithFindings();
    await runs.setRunStatus(id, [AssessmentStatus.Aggregating], AssessmentStatus.AwaitingApproval);
    await runs.setRunStatus(id, [AssessmentStatus.AwaitingApproval], AssessmentStatus.Persisting);

    await runs.approve(id);
    await runs.approve(id);

    const stored = await prisma.discoveredDomain.findMany({
      where: { assessmentId: id },
      orderBy: { domain: 'asc' },
    });
    expect(stored.map((row) => [row.domain, row.risk])).toEqual([
      ['a.example.com', RiskLevel.Medium],
      ['b.example.com', RiskLevel.High],
      ['c.example.com', RiskLevel.Critical],
    ]);
    expect((await reader.getRun(id))?.status).toBe(AssessmentStatus.Completed);
  });

  it('writes nothing for a run that is not PERSISTING', async () => {
    const id = await runWithFindings();
    await runs.setRunStatus(id, [AssessmentStatus.Aggregating], AssessmentStatus.AwaitingApproval);
    await runs.setRunStatus(id, [AssessmentStatus.AwaitingApproval], AssessmentStatus.Rejected);

    await runs.approve(id);

    expect(await prisma.discoveredDomain.count({ where: { assessmentId: id } })).toBe(0);
    expect(await prisma.stagedDiscovery.count({ where: { assessmentId: id } })).toBe(6); // kept (D4)
  });
});

describe('getDomains', () => {
  it('shows the deduplicated staged view before approve, the stored result after', async () => {
    const id = await runWithFindings();

    expect(await reader.getDomains(id)).toEqual({
      source: DomainSource.Staged,
      domains: [
        { domain: 'c.example.com', risk: RiskLevel.Critical, foundBy: 1 },
        { domain: 'b.example.com', risk: RiskLevel.High, foundBy: 2 },
        { domain: 'a.example.com', risk: RiskLevel.Medium, foundBy: 3 },
      ],
    });

    await runs.setRunStatus(id, [AssessmentStatus.Aggregating], AssessmentStatus.Persisting);
    await runs.approve(id);

    expect(await reader.getDomains(id)).toEqual({
      source: DomainSource.Final,
      domains: [
        { domain: 'c.example.com', risk: RiskLevel.Critical },
        { domain: 'b.example.com', risk: RiskLevel.High },
        { domain: 'a.example.com', risk: RiskLevel.Medium },
      ],
    });
  });

  it('is null for an unknown run', async () => {
    expect(await reader.getDomains(randomUUID())).toBeNull();
  });
});

describe('requests follow the legality table', () => {
  it('allows a decision only while awaiting approval, and only the first', async () => {
    const id = await runWithFindings();
    expect(await requests.requestDecision(id, Decision.Approve)).toBe(false); // AGGREGATING

    await runs.setRunStatus(id, [AssessmentStatus.Aggregating], AssessmentStatus.AwaitingApproval);
    expect(await requests.requestDecision(id, Decision.Reject)).toBe(true);
    expect(await requests.requestDecision(id, Decision.Approve)).toBe(false);
    expect((await reader.getRun(id))?.decision).toBe(Decision.Reject);
  });

  it('refuses a window change outside 1..agentCount or while a cancel is pending', async () => {
    const run = newRun({ agentCount: 4 });
    await requests.createRun(run);

    expect(await requests.setWindow(run.id, 5)).toBe(false);
    expect(await requests.setWindow(run.id, 4)).toBe(true);
    expect(await requests.requestCancel(run.id)).toBe(true);
    expect(await requests.requestCancel(run.id)).toBe(false);
    expect(await requests.setWindow(run.id, 1)).toBe(false);
    expect((await reader.getRun(run.id))?.windowSize).toBe(4);
  });
});

describe('withdrawing a request whose signal failed', () => {
  it('clears the pending request, so the action can be tried again', async () => {
    const id = await runWithFindings();
    await runs.setRunStatus(id, [AssessmentStatus.Aggregating], AssessmentStatus.AwaitingApproval);
    expect(await requests.requestDecision(id, Decision.Approve)).toBe(true);

    await requests.withdrawDecision(id);

    expect((await reader.getRun(id))?.decision).toBeNull();
    expect(await requests.requestDecision(id, Decision.Approve)).toBe(true);
  });

  it('changes nothing once the workflow has acted on the request', async () => {
    const run = newRun();
    await requests.createRun(run);
    expect(await requests.requestCancel(run.id)).toBe(true);
    await runs.setRunStatus(run.id, [AssessmentStatus.Starting], AssessmentStatus.Cancelled);

    await requests.withdrawCancel(run.id);

    expect((await reader.getRun(run.id))?.cancelRequestedAt).not.toBeNull();
  });
});

describe('statuses only move forward', () => {
  it('a status update from the wrong status changes nothing', async () => {
    const run = newRun();
    await requests.createRun(run);

    expect(await runs.setRunStatus(run.id, [AssessmentStatus.Starting], AssessmentStatus.Running)).toBe(true);
    expect(await runs.setRunStatus(run.id, [AssessmentStatus.Starting], AssessmentStatus.Running)).toBe(
      false,
    );
  });

  it('an agent keeps its first ending', async () => {
    const run = newRun();
    await requests.createRun(run);
    await startAgent(run.id, 0);

    await agents.endAgent(run.id, 0, { status: AgentStatus.Lost, lostReason: LostReason.NotFound });
    await agents.endAgent(run.id, 0, { status: AgentStatus.Stopped, stopConfirmed: true });

    const agent = (await reader.getRun(run.id))?.agents[0];
    expect([agent?.status, agent?.lostReason, agent?.stopConfirmed]).toEqual([
      AgentStatus.Lost,
      LostReason.NotFound,
      null,
    ]);
  });
});
