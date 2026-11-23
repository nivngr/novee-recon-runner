import { z } from 'zod';

const ApiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TASK_QUEUE: z.string().min(1).default('recon'),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/** Reads and validates the API's configuration from the environment; fails fast on bad values. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return ApiConfigSchema.parse(env);
}
