import { fileURLToPath } from 'node:url';
import { AgentLifecycle, createPrismaClient, RunLifecycle } from '@novee/db';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AgentActivities } from './activities/agent-activities.js';
import { RunActivities } from './activities/run-activities.js';
import { AgentServiceClient } from './agent-service/agent-service-client.js';
import { loadWorkerConfig } from './config.js';
import { LivenessFile } from './liveness.js';

const LIVENESS_INTERVAL_MS = 10_000;

const config = loadWorkerConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const agentActivities = new AgentActivities(
  new AgentServiceClient(config.AGENT_SERVICE_URL),
  new AgentLifecycle(prisma),
  config.POD_NAME,
);
const runActivities = new RunActivities(new RunLifecycle(prisma));

const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
const worker = await Worker.create({
  connection,
  namespace: config.TEMPORAL_NAMESPACE,
  taskQueue: config.TASK_QUEUE,
  // Pre-built at image-build time by scripts/bundle-workflows.ts.
  workflowBundle: { codePath: fileURLToPath(new URL('./workflow-bundle.js', import.meta.url)) },
  activities: { ...agentActivities, ...runActivities },
});

const liveness = new LivenessFile(config.HEALTH_FILE, LIVENESS_INTERVAL_MS);
liveness.start(() => worker.getState() === 'RUNNING');

try {
  await worker.run(); // returns after SIGTERM/SIGINT, once in-flight work is wound down
} finally {
  liveness.stop();
  await connection.close();
  await prisma.$disconnect();
}
