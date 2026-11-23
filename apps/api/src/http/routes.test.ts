import { ErrorCode, ErrorResponseSchema } from '@novee/contracts';
import { createPrismaClient, RunReader, RunRequests } from '@novee/db';
import { Client } from '@temporalio/client';
import { afterAll, describe, expect, it } from 'vitest';
import { RunService } from '../runs/run-service.js';
import { buildServer } from '../server.js';
import { RunWorkflows } from '../temporal/run-workflows.js';

// Fastify's own errors must answer in our error shape: the browser parses every response with the shared schema.
// The database and Temporal clients connect lazily, and these requests never reach them.
const prisma = createPrismaClient('postgresql://unused@localhost:1/unused');
const service = new RunService(
  new RunReader(prisma),
  new RunRequests(prisma),
  new RunWorkflows(new Client(), 'recon'),
);
const server = buildServer(service);

afterAll(() => server.close());

describe('error responses follow the contract', () => {
  it('an empty body labelled as JSON is a validation error, not Fastify’s own shape', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/assessments/7c9e6679-7425-40de-944b-e07fc1f90ae7/approve',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json()).error).toBe(ErrorCode.ValidationFailed);
  });

  it('an unknown route is not_found', async () => {
    const response = await server.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).error).toBe(ErrorCode.NotFound);
  });
});
