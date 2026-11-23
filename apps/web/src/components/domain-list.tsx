'use client';

import { type AssessmentStatus, DomainSource } from '@novee/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { RISK_LABEL } from '../lib/labels';
import { ErrorBanner } from './error-banner';

/** The findings to review: deduplicated staged findings before approve, the stored result after. */
export function DomainList({ runId, status }: { runId: string; status: AssessmentStatus }) {
  // Fetched once per status: the list only changes when the run moves on (to the stored result).
  const domains = useQuery({
    queryKey: ['domains', runId, status],
    queryFn: () => apiClient.getDomains(runId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <section>
      <h2>
        Subdomains{' '}
        {domains.data !== undefined && (
          <span className="muted">
            ({domains.data.domains.length},{' '}
            {domains.data.source === DomainSource.Final ? 'stored' : 'found, not stored yet'})
          </span>
        )}
      </h2>
      {domains.error !== null && <ErrorBanner error={domains.error} />}
      {domains.data !== undefined && (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table data-testid="domain-list">
            <thead>
              <tr>
                <th>Subdomain</th>
                <th>Risk</th>
                {domains.data.source === DomainSource.Staged && <th>Found by</th>}
              </tr>
            </thead>
            <tbody>
              {domains.data.source === DomainSource.Staged
                ? domains.data.domains.map((entry) => (
                    <tr key={entry.domain}>
                      <td>{entry.domain}</td>
                      <td className={`risk-${entry.risk}`}>{RISK_LABEL[entry.risk]}</td>
                      <td>
                        {entry.foundBy} agent{entry.foundBy === 1 ? '' : 's'}
                      </td>
                    </tr>
                  ))
                : domains.data.domains.map((entry) => (
                    <tr key={entry.domain}>
                      <td>{entry.domain}</td>
                      <td className={`risk-${entry.risk}`}>{RISK_LABEL[entry.risk]}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
