import {
  type ActionResponse,
  ActionResponseSchema,
  type DomainsResponse,
  DomainsResponseSchema,
  ErrorCode,
  ErrorResponseSchema,
  type RunList,
  RunListSchema,
  type RunView,
  RunViewSchema,
  type SubmitRequest,
  type SubmitResponse,
  SubmitResponseSchema,
  type WindowResponse,
  WindowResponseSchema,
} from '@novee/contracts';
import type { z } from 'zod';

/** The API answered with something the shared schema doesn't describe. The UI shows this, never partial data. */
export class ContractMismatchError extends Error {
  constructor(path: string, detail: string) {
    super(`contract mismatch on ${path}: ${detail}`);
    this.name = 'ContractMismatchError';
  }
}

/** The API answered with one of its error responses (or couldn't be reached). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The browser's client for our API, through the /api proxy. Every response is parsed with the shared schema. */
export class ApiClient {
  listRuns(limit = 20): Promise<RunList> {
    return this.call(`/assessments?limit=${limit}`, RunListSchema);
  }

  getRun(id: string): Promise<RunView> {
    return this.call(`/assessments/${id}`, RunViewSchema);
  }

  getDomains(id: string): Promise<DomainsResponse> {
    return this.call(`/assessments/${id}/domains`, DomainsResponseSchema);
  }

  submit(request: SubmitRequest): Promise<SubmitResponse> {
    return this.call('/assessments', SubmitResponseSchema, { method: 'POST', body: JSON.stringify(request) });
  }

  approve(id: string): Promise<ActionResponse> {
    return this.call(`/assessments/${id}/approve`, ActionResponseSchema, { method: 'POST' });
  }

  reject(id: string): Promise<ActionResponse> {
    return this.call(`/assessments/${id}/reject`, ActionResponseSchema, { method: 'POST' });
  }

  cancel(id: string): Promise<ActionResponse> {
    return this.call(`/assessments/${id}/cancel`, ActionResponseSchema, { method: 'POST' });
  }

  setWindow(id: string, size: number): Promise<WindowResponse> {
    return this.call(`/assessments/${id}/window`, WindowResponseSchema, {
      method: 'PUT',
      body: JSON.stringify({ size }),
    });
  }

  private async call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        ...init,
        headers: init?.body === undefined ? {} : { 'content-type': 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      throw new ApiError(ErrorCode.Unavailable, `could not reach the server: ${String(error)}`);
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = ErrorResponseSchema.safeParse(body);
      if (!failure.success)
        throw new ContractMismatchError(path, `HTTP ${response.status} without an error body`);
      throw new ApiError(failure.data.error, failure.data.message);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ContractMismatchError(path, parsed.error.message);
    return parsed.data;
  }
}

export const apiClient = new ApiClient();
