import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from './http/routes.js';
import type { RunService } from './runs/run-service.js';

/** Builds the HTTP server with its routes. Listening is the caller's job, so tests can use it directly. */
export function buildServer(service: RunService): FastifyInstance {
  const server = Fastify({ logger: true });
  registerRoutes(server, service);
  return server;
}
