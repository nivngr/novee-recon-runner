// Spike 02: one probe of both read paths. Usage: tsx src/probe.ts <workflowId> <label>
import { Client, Connection } from '@temporalio/client';
import { defaultPayloadConverter } from '@temporalio/common';
import { stateQuery } from './workflows';

const [workflowId, label] = process.argv.slice(2);
const client = new Client({ connection: await Connection.connect({ address: 'localhost:7233' }) });
const handle = client.workflow.getHandle(workflowId);

// Path A: ask the workflow (needs a worker to answer).
const t0 = Date.now();
try {
  const state = await handle.query(stateQuery);
  console.log(`[${label}] query OK in ${Date.now() - t0} ms:`, JSON.stringify(state));
} catch (e) {
  console.log(`[${label}] query FAILED after ${Date.now() - t0} ms: ${(e as Error).message}`);
}

// Describe: answered by the server alone. Last heartbeat of each running waitAgent.
const t1 = Date.now();
const d = await handle.describe();
console.log(`[${label}] describe OK in ${Date.now() - t1} ms, status ${d.status.name}`);
for (const a of d.raw.pendingActivities ?? []) {
  const p = a.heartbeatDetails?.payloads?.[0];
  const progress = p ? defaultPayloadConverter.fromPayload(p) : null;
  const hbSeconds = a.lastHeartbeatTime?.seconds;
  const age = hbSeconds ? Math.round(Date.now() / 1000 - Number(hbSeconds)) : null;
  console.log(`  ${a.activityType?.name}: last heartbeat progress=${progress}, ${age}s old`);
}
