// Spike: activities = the steps that touch the outside world (agent-service here).
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

const AGENT_SERVICE = 'http://127.0.0.1:18080';

// Start one agent. The idempotency key makes a retried start return the same agent.
export async function startAgent(domain: string, technique: string, key: string): Promise<string> {
  const res = await fetch(`${AGENT_SERVICE}/scans`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ domain, technique }),
  });
  if (res.status === 422) {
    throw ApplicationFailure.nonRetryable(`unsupported domain ${domain}`, 'UnsupportedDomain');
  }
  if (!res.ok) {
    throw new Error(`start failed: HTTP ${res.status}`); // retryable (e.g. 503)
  }
  const body = (await res.json()) as { scanId: string };
  return body.scanId;
}

// Wait for one agent to end, polling every second and heartbeating so a dead worker is noticed.
export async function waitAgent(scanId: string): Promise<string> {
  for (;;) {
    const res = await fetch(`${AGENT_SERVICE}/scans/${scanId}`);
    const body = (await res.json()) as { status: string; progress: number };
    if (body.status !== 'RUNNING') return body.status;
    Context.current().heartbeat(body.progress);
    await Context.current().sleep(1000);
  }
}
