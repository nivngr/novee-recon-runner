'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '../lib/api-client';
import { PENDING_LABEL, RUN_STATUS_LABEL } from '../lib/labels';
import { SLOW_POLL_MS } from '../lib/polling';
import { ErrorBanner } from './error-banner';

export function RunList() {
  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => apiClient.listRuns(),
    refetchInterval: SLOW_POLL_MS,
  });

  return (
    <section>
      <h2>Recent runs</h2>
      {runs.error !== null && <ErrorBanner error={runs.error} />}
      {runs.data?.length === 0 && <p className="muted">No runs yet.</p>}
      {runs.data !== undefined && runs.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Status</th>
                <th>Agents</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link href={`/runs/${run.id}`}>{run.domain}</Link>
                  </td>
                  <td>
                    {RUN_STATUS_LABEL[run.status]}
                    {run.pending !== null && <span className="muted"> — {PENDING_LABEL[run.pending]}</span>}
                  </td>
                  <td>{run.agentCount}</td>
                  <td className="muted">{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
