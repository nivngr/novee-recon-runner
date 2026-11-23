/** What a `POST /scans` status code means for the start (plan §3). */
export const StartVerdict = {
  Started: 'started',
  Retryable: 'retryable',
  UnsupportedDomain: 'unsupported_domain',
  BadRequest: 'bad_request',
} as const;
export type StartVerdict = (typeof StartVerdict)[keyof typeof StartVerdict];

export function classifyStartStatus(status: number): StartVerdict {
  if (status === 200 || status === 202) return StartVerdict.Started; // 200 = a replay of the same idempotency key
  if (status === 422) return StartVerdict.UnsupportedDomain;
  if (status === 400) return StartVerdict.BadRequest;
  return StartVerdict.Retryable; // 503 pool exhausted, 429 cap reached, and anything unexpected
}
