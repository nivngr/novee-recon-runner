import { RiskLevel, type Technique } from '@novee/contracts';
import { z } from 'zod';
import { classifyStartStatus, StartVerdict } from './classify.js';

/** A scan's status, as agent-service reports it. */
export const ScanStatus = {
  Running: 'RUNNING',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Stopped: 'STOPPED',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

const ScanSchema = z.object({
  scanId: z.string().min(1),
  status: z.enum(ScanStatus),
  progress: z.number().min(0).max(1),
  startedAt: z.iso.datetime({ offset: true }),
  /** null until COMPLETED. */
  discovered: z.array(z.object({ domain: z.string().min(1), risk: z.enum(RiskLevel) })).nullable(),
});
export type Scan = z.infer<typeof ScanSchema>;

export type StartResult =
  | { verdict: typeof StartVerdict.Started; scanId: string }
  | { verdict: typeof StartVerdict.Retryable; status: number }
  | { verdict: typeof StartVerdict.UnsupportedDomain }
  | { verdict: typeof StartVerdict.BadRequest; body: string };

const REQUEST_TIMEOUT_MS = 5_000;

/** The given agent-service's scan API. Never calls `/admin/*`. Network errors are thrown to the caller. */
export class AgentServiceClient {
  constructor(private readonly baseUrl: string) {}

  async startScan(domain: string, technique: Technique, idempotencyKey: string): Promise<StartResult> {
    const response = await this.request('/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ domain, technique }),
    });
    const verdict = classifyStartStatus(response.status);
    switch (verdict) {
      case StartVerdict.Started:
        return { verdict, scanId: ScanSchema.parse(await response.json()).scanId };
      case StartVerdict.UnsupportedDomain:
        return { verdict };
      case StartVerdict.BadRequest:
        return { verdict, body: await response.text() };
      case StartVerdict.Retryable:
        return { verdict, status: response.status };
    }
  }

  /** `null` if agent-service doesn't know the scan (404). */
  async getScan(scanId: string): Promise<Scan | null> {
    const response = await this.request(`/scans/${encodeURIComponent(scanId)}`, { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET /scans/${scanId}: HTTP ${response.status}`);
    return ScanSchema.parse(await response.json());
  }

  /** Safe to repeat: stopping a finished scan is a no-op, and an unknown one (404) has nothing to stop. */
  async stopScan(scanId: string): Promise<void> {
    const response = await this.request(`/scans/${encodeURIComponent(scanId)}/stop`, { method: 'POST' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`POST /scans/${scanId}/stop: HTTP ${response.status}`);
    }
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return fetch(new URL(path, this.baseUrl), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
}
