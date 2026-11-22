import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { loadWorkerConfig } from './config.js';
import { LivenessFile } from './liveness.js';

const LIVENESS_INTERVAL_MS = 10_000;

const config = loadWorkerConfig();
const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
const worker = await Worker.create({
  connection,
  namespace: config.TEMPORAL_NAMESPACE,
  taskQueue: config.TASK_QUEUE,
  // Pre-built at image-build time by scripts/bundle-workflows.ts.
  workflowBundle: { codePath: fileURLToPath(new URL('./workflow-bundle.js', import.meta.url)) },
});

const liveness = new LivenessFile(config.HEALTH_FILE, LIVENESS_INTERVAL_MS);
liveness.start(() => worker.getState() === 'RUNNING');

try {
  await worker.run(); // returns after SIGTERM/SIGINT, once in-flight work is wound down
} finally {
  liveness.stop();
  await connection.close();
}
