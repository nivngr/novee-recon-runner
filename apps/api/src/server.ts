import Fastify, { type FastifyInstance } from 'fastify';

/** Builds the HTTP server with its routes. Listening is the caller's job, so tests can use it directly. */
export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: true });

  server.get('/healthz', async () => ({ status: 'ok' }));

  return server;
}
