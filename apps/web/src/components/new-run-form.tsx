'use client';

import { RUN_LIMITS, type SubmitRequest, SubmitRequestSchema } from '@novee/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, type SubmitEvent, useRef, useState } from 'react';
import { apiClient } from '../lib/api-client';

interface FormValues {
  domain: string;
  agentCount: string;
  windowSize: string;
  stallTimeoutS: string;
  maxAgentDurationS: string;
  failFirstAttempts: string;
}

const DEFAULTS: FormValues = {
  domain: '',
  agentCount: String(RUN_LIMITS.agentCount.default),
  windowSize: String(RUN_LIMITS.windowSize.default),
  stallTimeoutS: String(RUN_LIMITS.stallTimeoutS.default),
  maxAgentDurationS: String(RUN_LIMITS.maxAgentDurationS.default),
  failFirstAttempts: String(RUN_LIMITS.failFirstAttempts.default),
};

/** Starts a run. The run's id is made here and kept across retries, so a repeated submit is harmless (D12). */
export function NewRunForm() {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [problems, setProblems] = useState<string[]>([]);
  // Same values → same id on every retry; any change makes it a different request, with a new id.
  const runId = useRef<string | null>(null);

  const submit = useMutation({
    mutationFn: (request: SubmitRequest) => apiClient.submit(request),
    onSuccess: ({ id }) => router.push(`/runs/${id}`),
  });

  const change = (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    runId.current = null;
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    runId.current ??= crypto.randomUUID();
    const request: SubmitRequest = {
      id: runId.current,
      domain: values.domain,
      agentCount: Number(values.agentCount),
      windowSize: Number(values.windowSize),
      settings: {
        stallTimeoutS: Number(values.stallTimeoutS),
        maxAgentDurationS: Number(values.maxAgentDurationS),
        failFirstAttempts: Number(values.failFirstAttempts),
      },
    };
    const checked = SubmitRequestSchema.safeParse(request);
    setProblems(
      checked.success ? [] : checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
    if (checked.success) submit.mutate(request);
  };

  return (
    <section>
      <h2>New run</h2>
      <form onSubmit={onSubmit}>
        <div className="row">
          <label>
            Domain
            <input
              name="domain"
              placeholder="example.com"
              value={values.domain}
              onChange={change('domain')}
              style={{ width: 260 }}
            />
          </label>
          <label>
            Agents
            <input
              name="agentCount"
              type="number"
              value={values.agentCount}
              onChange={change('agentCount')}
            />
          </label>
          <label>
            Window
            <input
              name="windowSize"
              type="number"
              value={values.windowSize}
              onChange={change('windowSize')}
            />
          </label>
          <button type="submit" disabled={submit.isPending}>
            {submit.isPending ? 'Starting…' : 'Start run'}
          </button>
        </div>
        <details>
          <summary>Advanced</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              No-progress timeout (s)
              <input
                name="stallTimeoutS"
                type="number"
                value={values.stallTimeoutS}
                onChange={change('stallTimeoutS')}
              />
            </label>
            <label>
              Agent ceiling (s)
              <input
                name="maxAgentDurationS"
                type="number"
                value={values.maxAgentDurationS}
                onChange={change('maxAgentDurationS')}
              />
            </label>
            <label>
              Fail first attempts (retry test)
              <input
                name="failFirstAttempts"
                type="number"
                value={values.failFirstAttempts}
                onChange={change('failFirstAttempts')}
              />
            </label>
          </div>
        </details>
        {problems.length > 0 && (
          <ul className="errors">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {submit.error !== null && (
          <p className="errors">{submit.error.message} — submitting again is safe.</p>
        )}
      </form>
    </section>
  );
}
