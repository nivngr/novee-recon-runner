// Records one real run's history as the replay-test fixture (plan §9). Needs a running worker, Temporal,
// agent-service and a migrated database:
//   DATABASE_URL=… node dist/scripts/record-history.js
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { AssessmentStatus, type ReconInput, Signal, WORKFLOW_TYPE, workflowIdFor } from '@novee/contracts';
import { createPrismaClient, RunReader, RunRequests } from '@novee/db';
import { Client, Connection } from '@temporalio/client';
import { historyToJSON } from '@temporalio/common/proto-utils';
import { z } from 'zod';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
    TASK_QUEUE: z.string().default('recon'),
    FIXTURE: z.string().default('src/workflows/fixtures/recon-history.json'),
  })
  .parse(process.env);

const prisma = createPrismaClient(env.DATABASE_URL);
const input: ReconInput = {
  runId: randomUUID(),
  domain: 'example.com',
  agentCount: 4,
  windowSize: 2,
  // failFirstAttempts 1: the history then also shows retried activities.
  settings: { stallTimeoutS: 60, maxAgentDurationS: 300, failFirstAttempts: 1 },
};
await new RunRequests(prisma).createRun({ ...input, id: input.runId });

const client = new Client({ connection: await Connection.connect({ address: env.TEMPORAL_ADDRESS }) });
const handle = await client.workflow.start(WORKFLOW_TYPE, {
  taskQueue: env.TASK_QUEUE,
  workflowId: workflowIdFor(input.runId),
  args: [input],
});
console.log(`started ${handle.workflowId}`);

const reader = new RunReader(prisma);
for (;;) {
  const run = await reader.getRun(input.runId);
  if (run?.status === AssessmentStatus.AwaitingApproval) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await handle.signal(Signal.Approve);
console.log(`result: ${await handle.result()}`);

// The fixture is committed: keep this machine's hostname and home path out of it (worker identity, stack traces).
// historyToJSON writes the canonical format (as `temporal workflow show --output json` does), which the replayer reads.
const history = JSON.stringify(JSON.parse(historyToJSON(await handle.fetchHistory())), null, 2)
  .replaceAll(homedir(), '~')
  .replaceAll(hostname().replace(/\.local$/, ''), 'dev-host');
await writeFile(env.FIXTURE, history);
console.log(`history written to ${env.FIXTURE}`);
await prisma.$disconnect();
