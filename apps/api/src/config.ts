import { z } from 'zod';

const ApiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/** Reads and validates the API's configuration from the environment; fails fast on bad values. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return ApiConfigSchema.parse(env);
}
