// Spike: plays the API's role. Starts a run, raises the window mid-run, waits for the end.
import { Client, Connection } from '@temporalio/client';
import { recon, setWindow } from './workflows';

const RAISE_AFTER_MS = Number(process.env.RAISE_AFTER_MS ?? 15000);

const client = new Client({ connection: await Connection.connect({ address: 'localhost:7233' }) });
const workflowId = `spike-window-${Date.now()}`;
const handle = await client.workflow.start(recon, {
  taskQueue: 'spike-window',
  workflowId,
  args: ['acme.com', 6, 2],
});
console.log(`${new Date().toISOString()} started ${workflowId} (6 agents, window 2)`);

await new Promise((r) => setTimeout(r, RAISE_AFTER_MS));
await handle.signal(setWindow, 3);
console.log(`${new Date().toISOString()} sent setWindow(3)`);

const result = await handle.result();
console.log(`${new Date().toISOString()} result:`, result);
