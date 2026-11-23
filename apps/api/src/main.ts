import { createPrismaClient, RunReader, RunRequests } from '@novee/db';
import { Client, Connection } from '@temporalio/client';
import { loadApiConfig } from './config.js';
import { RunService } from './runs/run-service.js';
import { buildServer } from './server.js';
import { RunWorkflows } from './temporal/run-workflows.js';

const config = loadApiConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
const service = new RunService(
  new RunReader(prisma),
  new RunRequests(prisma),
  new RunWorkflows(client, config.TASK_QUEUE),
);
const server = buildServer(service);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void server
      .close()
      .then(() => Promise.all([connection.close(), prisma.$disconnect()]))
      .then(() => process.exit(0));
  });
}

await server.listen({ host: '0.0.0.0', port: config.PORT });
