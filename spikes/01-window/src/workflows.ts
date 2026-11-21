// Spike: the window, as designed in docs/design/tech-design.md.
import { condition, defineSignal, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import type * as activities from './activities';

const { startAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { initialInterval: '1s', backoffCoefficient: 2 },
});
const { waitAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
  heartbeatTimeout: '10s',
});

export const setWindow = defineSignal<[number]>('setWindow');

const TECHNIQUES = ['dns-brute', 'cert-transparency', 'passive-dns', 'web-crawl'];

export async function recon(domain: string, agents: number, initialWindow: number): Promise<string[]> {
  let window = initialWindow;
  let running = 0;
  setHandler(setWindow, (n) => {
    window = n;
  });

  const outcomes: string[] = [];
  const lane = async (i: number): Promise<void> => {
    try {
      const key = `${workflowInfo().workflowId}-agent-${i}`;
      const scanId = await startAgent(domain, TECHNIQUES[i % TECHNIQUES.length], key);
      outcomes[i] = await waitAgent(scanId);
    } finally {
      running -= 1; // any ending frees the slot
    }
  };

  const lanes: Promise<void>[] = [];
  for (let i = 0; i < agents; i++) {
    await condition(() => running < window); // sleep until a slot is free
    running += 1; // slot taken when we decide to start
    lanes.push(lane(i));
  }
  await Promise.all(lanes);
  return outcomes;
}
