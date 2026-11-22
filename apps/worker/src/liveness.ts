import { writeFile } from 'node:fs/promises';

/**
 * The worker's liveness signal without an HTTP server (R9): while the worker is healthy, a file's
 * modification time is refreshed every few seconds. Kubernetes runs an exec probe that fails when the file
 * goes stale, and restarts the pod.
 */
export class LivenessFile {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly path: string,
    private readonly intervalMs: number,
  ) {}

  /** Starts touching the file on every tick where `isHealthy()` returns true. */
  start(isHealthy: () => boolean): void {
    const tick = (): void => {
      if (isHealthy()) {
        writeFile(this.path, new Date().toISOString()).catch((error: unknown) => {
          console.error(`liveness: could not write ${this.path}`, error);
        });
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
