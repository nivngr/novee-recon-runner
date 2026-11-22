// Spike 03: spike 01's activities plus stopAgent, with logging to see cancellation arrive.
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

const AGENT_SERVICE = 'http://127.0.0.1:18080';
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);

export async function startAgent(domain: string, technique: string, key: string): Promise<string> {
  const res = await fetch(`${AGENT_SERVICE}/scans`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ domain, technique }),
  });
  if (res.status === 422) throw ApplicationFailure.nonRetryable(`unsupported domain ${domain}`);
  if (!res.ok) {
    log(`startAgent ${key}: HTTP ${res.status}, will retry`);
    throw new Error(`start failed: HTTP ${res.status}`);
  }
  const { scanId } = (await res.json()) as { scanId: string };
  log(`startAgent ${key}: started ${scanId}`);
  return scanId;
}

export async function waitAgent(scanId: string): Promise<string> {
  try {
    for (;;) {
      const res = await fetch(`${AGENT_SERVICE}/scans/${scanId}`);
      const body = (await res.json()) as { status: string; progress: number };
      if (body.status !== 'RUNNING') return body.status;
      Context.current().heartbeat(body.progress);
      await Context.current().sleep(1000);
    }
  } catch (err) {
    log(`waitAgent ${scanId}: exiting (${(err as Error).name})`);
    throw err;
  }
}

export async function stopAgent(scanId: string): Promise<string> {
  const res = await fetch(`${AGENT_SERVICE}/scans/${scanId}/stop`, { method: 'POST' });
  if (res.status === 404) {
    log(`stopAgent ${scanId}: unknown to agent-service, nothing to stop`);
    return 'UNKNOWN';
  }
  if (!res.ok) throw new Error(`stop failed: HTTP ${res.status}`);
  const { status } = (await res.json()) as { status: string };
  log(`stopAgent ${scanId}: ${status}`);
  return status;
}
