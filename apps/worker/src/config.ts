import { hostname } from 'node:os';
import { z } from 'zod';

const WorkerConfigSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TASK_QUEUE: z.string().min(1).default('recon'),
  HEALTH_FILE: z.string().min(1).default('/tmp/healthy'),
  AGENT_SERVICE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  /** Recorded on each agent row it handles. From the downward API in k8s; the hostname elsewhere. */
  POD_NAME: z.string().min(1).default(hostname()),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

/** Reads and validates the worker's configuration from the environment; fails fast on bad values. */
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return WorkerConfigSchema.parse(env);
}
