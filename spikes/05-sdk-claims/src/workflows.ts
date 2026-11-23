// Spike 05 workflows: one per claim.
import { condition, defineSignal, defineUpdate, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type * as activities from './activities';

// D1: what does the sandbox do to non-deterministic calls?
export async function sandbox(): Promise<{ fetch: string; random: number; nowBefore: number; nowAfter: number }> {
  const random = Math.random();
  // Branch on the random value: if replay produced a different number, it would issue different commands
  // and the replayer would report non-determinism.
  if (random < 0.5) await sleep(10);
  else await sleep(20);
  const nowBefore = Date.now();
  let spin = 0;
  for (let i = 0; i < 5_000_000; i++) spin += i; // real time passes; does workflow time?
  const nowAfter = Date.now() + (spin > 0 ? 0 : 1);
  return { fetch: typeof (globalThis as { fetch?: unknown }).fetch, random, nowBefore, nowAfter };
}

// D8: is a signal kept while no worker is running?
export const go = defineSignal('go');
export const ask = defineUpdate<string>('ask');
export async function waitsForSignal(): Promise<string> {
  let got = false;
  setHandler(go, () => {
    got = true;
  });
  setHandler(ask, () => 'answer');
  await condition(() => got);
  return 'got the signal';
}

// D7: do heartbeat details reach the next attempt?
const { resumable } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1m',
  heartbeatTimeout: '3s',
  retry: { initialInterval: '1s', maximumAttempts: 3 },
});
export async function heartbeatCarry(): Promise<string> {
  return resumable();
}
