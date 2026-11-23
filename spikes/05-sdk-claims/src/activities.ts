import { Context } from '@temporalio/activity';

/** Attempt 1 heartbeats {lastProgress: 0.4}, then goes silent like a dead worker. Later attempts report what they received. */
export async function resumable(): Promise<string> {
  const { attempt, heartbeatDetails } = Context.current().info;
  if (attempt === 1) {
    Context.current().heartbeat({ lastProgress: 0.4, lastChangeAt: 1234 });
    await new Promise((resolve) => setTimeout(resolve, 8000)); // no heartbeats: Temporal times it out at 3s
    return 'attempt 1 should have been timed out';
  }
  return `attempt ${attempt} received heartbeatDetails=${JSON.stringify(heartbeatDetails)}`;
}
