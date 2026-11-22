import { loadApiConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadApiConfig();
const server = buildServer();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}

await server.listen({ host: '0.0.0.0', port: config.PORT });
