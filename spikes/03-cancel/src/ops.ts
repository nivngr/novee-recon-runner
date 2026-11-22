// Spike 03: tiny client. Usage: tsx src/ops.ts start <domain> | cancel <id> | status <id>
import { Client, Connection } from '@temporalio/client';
import { recon } from './workflows';

const [op, arg] = process.argv.slice(2);
const client = new Client({ connection: await Connection.connect({ address: 'localhost:7233' }) });
const now = () => new Date().toISOString().slice(11, 23);

if (op === 'start') {
  const workflowId = `spike-cancel-${Date.now()}`;
  await client.workflow.start(recon, { taskQueue: 'spike-cancel', workflowId, args: [arg, 6, 2] });
  console.log(workflowId);
} else if (op === 'cancel') {
  const t0 = Date.now();
  await client.workflow.getHandle(arg).cancel();
  console.log(`${now()} cancel accepted in ${Date.now() - t0} ms`);
} else if (op === 'status') {
  const d = await client.workflow.getHandle(arg).describe();
  console.log(`${now()} workflow status: ${d.status.name}`);
}
