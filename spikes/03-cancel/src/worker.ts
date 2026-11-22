// Spike: the worker process. Connects out to Temporal and runs our workflow + activity code.
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import * as activities from './activities';

const connection = await NativeConnection.connect({ address: 'localhost:7233' });
const worker = await Worker.create({
  connection,
  taskQueue: 'spike-cancel',
  workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
  activities,
});
console.log('worker running on task queue spike-cancel');
await worker.run();
