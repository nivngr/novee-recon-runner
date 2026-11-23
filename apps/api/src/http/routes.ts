import {
  ErrorCode,
  type ErrorResponse,
  RunAction,
  SubmitRequestSchema,
  WindowRequestSchema,
} from '@novee/contracts';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RequestAction, Result, RunService } from '../runs/run-service.js';

const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  [ErrorCode.ValidationFailed]: 400,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.IdConflict]: 409,
  [ErrorCode.NotAllowed]: 409,
  [ErrorCode.Unavailable]: 503,
  [ErrorCode.Internal]: 500,
};

const IdParamsSchema = z.object({ id: z.uuid() });
const ListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** REST endpoints (plan §6). Inputs are parsed with the shared schemas; outputs are the shared types. */
export function registerRoutes(server: FastifyInstance, service: RunService): void {
  // Fastify's own errors (a malformed body, an unknown route, a crash) answer in our error shape too, so every
  // response the browser gets matches the shared contract.
  server.setErrorHandler((error: FastifyError, request, reply) => {
    const clientError = error.statusCode !== undefined && error.statusCode < 500;
    if (!clientError) request.log.error(error);
    return sendError(reply, clientError ? ErrorCode.ValidationFailed : ErrorCode.Internal, error.message);
  });
  server.setNotFoundHandler((request, reply) =>
    sendError(reply, ErrorCode.NotFound, `no route ${request.method} ${request.url}`),
  );

  server.post('/assessments', async (request, reply) => {
    const body = SubmitRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, ErrorCode.ValidationFailed, z.prettifyError(body.error));
    const result = await service.submit(body.data);
    if (!result.ok) return sendError(reply, result.error, result.message);
    return reply.code(result.value.created ? 201 : 200).send({ id: result.value.id });
  });

  server.get('/assessments', async (request, reply) => {
    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) return sendError(reply, ErrorCode.ValidationFailed, z.prettifyError(query.error));
    return reply.send(await service.list(query.data.limit));
  });

  server.get('/assessments/:id', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, ErrorCode.NotFound, 'no such run');
    return sendResult(reply, await service.get(params.data.id), 200);
  });

  server.get('/assessments/:id/domains', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, ErrorCode.NotFound, 'no such run');
    return sendResult(reply, await service.domains(params.data.id), 200);
  });

  const requestRoutes: ReadonlyArray<[string, RequestAction]> = [
    ['approve', RunAction.Approve],
    ['reject', RunAction.Reject],
    ['cancel', RunAction.Cancel],
  ];
  for (const [path, action] of requestRoutes) {
    server.post(`/assessments/:id/${path}`, async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      if (!params.success) return sendError(reply, ErrorCode.NotFound, 'no such run');
      return sendResult(reply, await service.request(params.data.id, action), 202);
    });
  }

  server.put('/assessments/:id/window', async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, ErrorCode.NotFound, 'no such run');
    const body = WindowRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, ErrorCode.ValidationFailed, z.prettifyError(body.error));
    return sendResult(reply, await service.setWindow(params.data.id, body.data.size), 202);
  });

  /** Liveness: the process answers. Kept free of dependencies, so an outage elsewhere never restarts the API. */
  server.get('/livez', async () => ({ status: 'ok' }));

  /** Readiness: the database and Temporal are reachable. */
  server.get('/healthz', async (_request, reply) => {
    try {
      await service.checkHealth();
      return reply.send({ status: 'ok' });
    } catch (error) {
      return sendError(reply, ErrorCode.Unavailable, String(error));
    }
  });
}

function sendResult<T>(reply: FastifyReply, result: Result<T>, successStatus: number): FastifyReply {
  return result.ok
    ? reply.code(successStatus).send(result.value)
    : sendError(reply, result.error, result.message);
}

function sendError(reply: FastifyReply, error: ErrorCode, message: string): FastifyReply {
  const body: ErrorResponse = { error, message };
  return reply.code(HTTP_STATUS[error]).send(body);
}
