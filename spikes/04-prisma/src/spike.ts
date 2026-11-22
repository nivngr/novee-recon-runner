// Spike 04: can Prisma do our critical writes? Three questions, printed as answers.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { approve } from './generated/prisma/sql';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const run = '11111111-1111-1111-1111-111111111111';

// Three agents; a.example appears three times with different risks, b.example twice.
const staged = [
  { agentIndex: 0, domain: 'a.example', risk: 'LOW' },
  { agentIndex: 0, domain: 'b.example', risk: 'HIGH' },
  { agentIndex: 1, domain: 'a.example', risk: 'MEDIUM' },
  { agentIndex: 1, domain: 'c.example', risk: 'CRITICAL' },
  { agentIndex: 2, domain: 'a.example', risk: 'LOW' },
  { agentIndex: 2, domain: 'b.example', risk: 'LOW' },
] as const;

await prisma.discoveredDomain.deleteMany();
await prisma.stagedDiscovery.deleteMany();

// Q1: a retried staging write doesn't duplicate.
const data = staged.map((s) => ({ ...s, assessmentId: run }));
const first = await prisma.stagedDiscovery.createMany({ data, skipDuplicates: true });
const retry = await prisma.stagedDiscovery.createMany({ data, skipDuplicates: true });
console.log(`Q1 staging: first write ${first.count} rows, retried write ${retry.count} rows,`,
  `table has ${await prisma.stagedDiscovery.count()}`);

// Q2: groupBy with max on an enum column.
try {
  const groups = await prisma.stagedDiscovery.groupBy({
    by: ['domain'],
    where: { assessmentId: run },
    _max: { risk: true },
    orderBy: { domain: 'asc' },
  });
  console.log('Q2 groupBy max(risk):', groups.map((g) => `${g.domain}=${g._max.risk}`).join(', '));
} catch (e) {
  console.log('Q2 groupBy max(risk) FAILED:', (e as Error).message.split('\n')[0]);
}

// Q3: the approve statement as TypedSQL, run twice (a retried approve).
await prisma.$queryRawTyped(approve(run));
await prisma.$queryRawTyped(approve(run));
const results = await prisma.discoveredDomain.findMany({ where: { assessmentId: run }, orderBy: { domain: 'asc' } });
console.log('Q3 approve x2 via TypedSQL:', results.map((r) => `${r.domain}=${r.risk}`).join(', '),
  `(${results.length} rows)`);

await prisma.$disconnect();
