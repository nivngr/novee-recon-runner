// Spike 05: settles the four claims marked "per the docs". Needs Temporal on localhost:7233.
import { fileURLToPath } from 'node:url';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { bundleWorkflowCode, NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { ask, go } from './workflows';

const queue = `spike-05-${Date.now()}`;
const client = new Client({ connection: await Connection.connect({ address: 'localhost:7233' }) });
const workflowsPath = fileURLToPath(new URL('./workflows.ts', import.meta.url));
const newWorker = async () =>
  Worker.create({
    connection: await NativeConnection.connect({ address: 'localhost:7233' }),
    taskQueue: queue,
    workflowsPath,
    activities,
  });

// D8 first, before any worker exists on this queue.
const signalled = await client.workflow.start('waitsForSignal', { taskQueue: queue, workflowId: `${queue}-signal` });
await signalled.signal(go);
const updateResult = await Promise.race([
  signalled.executeUpdate(ask).then((r) => `answered: ${r}`),
  new Promise<string>((resolve) => setTimeout(() => resolve('no answer within 5s'), 5000)),
]).catch((e: Error) => `error: ${e.name}`);
console.log(`D8 update sent with no worker running: ${updateResult}`);

const worker = await newWorker();
await worker.runUntil(async () => {
  console.log(`D8 signal sent with no worker running, worker started later: ${await signalled.result()}`);

  // D1
  const values = [];
  for (let i = 0; i < 4; i++) {
    const h = await client.workflow.start('sandbox', { taskQueue: queue, workflowId: `${queue}-sandbox-${i}` });
    values.push(await h.result());
    const history = await h.fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history); // throws on non-determinism
  }
  console.log('D1 sandbox results:', JSON.stringify(values));
  console.log('D1 replayed all 4 histories with no non-determinism error (Math.random gave the same branch on replay)');

  // D7
  const t0 = Date.now();
  const carried = await client.workflow.execute('heartbeatCarry', { taskQueue: queue, workflowId: `${queue}-hb` });
  console.log(`D7 ${carried} (after ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // D12
  const id = `${queue}-dup`;
  const first = await client.workflow.start('waitsForSignal', { taskQueue: queue, workflowId: id });
  const again = await client.workflow.start('waitsForSignal', {
    taskQueue: queue,
    workflowId: id,
    workflowIdConflictPolicy: 'USE_EXISTING',
  });
  console.log(`D12 USE_EXISTING: same run = ${first.firstExecutionRunId === again.firstExecutionRunId}`);
  try {
    await client.workflow.start('waitsForSignal', { taskQueue: queue, workflowId: id });
    console.log('D12 default policy: started a second one?!');
  } catch (e) {
    console.log(`D12 default policy: ${e instanceof WorkflowExecutionAlreadyStartedError ? 'WorkflowExecutionAlreadyStartedError' : e}`);
  }
  await first.signal(go);
  await first.result();
});

try {
  await bundleWorkflowCode({ workflowsPath: fileURLToPath(new URL('./forbidden.ts', import.meta.url)) });
  console.log('D1 bundling a workflow that imports node:fs: succeeded?!');
} catch (e) {
  console.log(`D1 bundling a workflow that imports node:fs: rejected — ${(e as Error).message.split('\n').slice(0, 3).join(' | ')}`);
}
process.exit(0);
