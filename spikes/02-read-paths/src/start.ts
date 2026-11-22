// Spike 02: start a run and print its workflow id.
import { Client, Connection } from '@temporalio/client';
import { recon } from './workflows';

const client = new Client({ connection: await Connection.connect({ address: 'localhost:7233' }) });
const workflowId = `spike-read-${Date.now()}`;
await client.workflow.start(recon, { taskQueue: 'spike-window', workflowId, args: ['acme.com', 6, 2] });
console.log(workflowId);
