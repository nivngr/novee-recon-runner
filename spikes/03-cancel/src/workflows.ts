// Spike 03: the window from spike 01, plus cancellation and cleanup as designed (question 5).
import {
  CancellationScope,
  condition,
  isCancellation,
  proxyActivities,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities';

const { startAgent, stopAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '5s' },
});
const { waitAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '10s',
});

const TECHNIQUES = ['dns-brute', 'cert-transparency', 'passive-dns', 'web-crawl'];

export async function recon(domain: string, agents: number, window: number): Promise<string[]> {
  let running = 0;
  const scanIds = new Map<number, string>(); // agents we know we started
  const ended = new Set<number>();
  const outcomes: string[] = [];

  const lane = async (i: number): Promise<void> => {
    try {
      // A start in flight is never cancelled: we must learn its scan id to stop it.
      const scanId = await CancellationScope.nonCancellable(() =>
        startAgent(domain, TECHNIQUES[i % TECHNIQUES.length], `${workflowInfo().workflowId}-agent-${i}`),
      );
      scanIds.set(i, scanId);
      outcomes[i] = await waitAgent(scanId); // cancellable
      ended.add(i);
    } finally {
      running -= 1;
    }
  };

  const lanes: Promise<void>[] = [];
  try {
    for (let i = 0; i < agents; i++) {
      await condition(() => running < window);
      running += 1;
      const p = lane(i);
      p.catch(() => {}); // mark handled now: a lane's cancellation error must never go unheard
      lanes.push(p);
    }
    await Promise.all(lanes);
    return outcomes;
  } catch (err) {
    if (!isCancellation(err)) throw err;
    // Cleanup runs after the cancellation, and must not itself be cancelled.
    await CancellationScope.nonCancellable(async () => {
      // Collect every lane first: absorbs their cancellation errors (otherwise "unhandled
      // rejection" fails the workflow task forever) and waits for in-flight starts.
      await Promise.allSettled(lanes);
      const toStop = [...scanIds].filter(([i]) => !ended.has(i)).map(([, id]) => id);
      await Promise.all(toStop.map((id) => stopAgent(id)));
    });
    throw err; // end the workflow as cancelled
  }
}
