'use client';

import { AssessmentStatus, ErrorCode, type RunView, WORKFLOW_STEP } from '@novee/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ApiError, apiClient, ContractMismatchError } from '../lib/api-client';
import { FAILURE_LABEL, PENDING_LABEL, RUN_STATUS_LABEL } from '../lib/labels';
import { runPollInterval } from '../lib/polling';
import { AgentTable } from './agent-table';
import { DomainList } from './domain-list';
import { ErrorBanner } from './error-banner';
import { RunControls } from './run-controls';

/** Statuses where there's a findings list worth reviewing. */
const HAS_DOMAINS: readonly AssessmentStatus[] = [
  AssessmentStatus.AwaitingApproval,
  AssessmentStatus.Persisting,
  AssessmentStatus.Completed,
  AssessmentStatus.Rejected,
];

/** One run, polled (D11). Everything shown comes from the last successful poll: nothing is assumed ahead of it (R8). */
export function RunDetail({ id }: { id: string }) {
  const run = useQuery({
    queryKey: ['run', id],
    queryFn: () => apiClient.getRun(id),
    // A contract mismatch won't fix itself: stop polling. Any other error: keep polling, it may pass.
    refetchInterval: (query) =>
      query.state.error instanceof ContractMismatchError ? false : runPollInterval(query.state.data),
  });

  if (run.error instanceof ContractMismatchError) return <ErrorBanner error={run.error} />;
  if (run.error instanceof ApiError && run.error.code === ErrorCode.NotFound) return <p>No such run.</p>;
  if (run.data === undefined)
    return run.error === null ? <p className="muted">Loading…</p> : <ErrorBanner error={run.error} />;

  const view = run.data;
  return (
    <>
      <p>
        <Link href="/">← All runs</Link>
      </p>
      {run.error !== null && (
        <div className="banner warn">
          Can't refresh right now ({run.error.message}). Showing the last update, from{' '}
          {new Date(run.dataUpdatedAt).toLocaleTimeString()}.
        </div>
      )}
      {view.stuck !== null && (
        <div className="banner error" data-testid="run-stuck">
          This run is stuck:{' '}
          {view.stuck.step === WORKFLOW_STEP
            ? 'its workflow code keeps failing'
            : `${view.stuck.step} keeps failing`}{' '}
          (attempt {view.stuck.attempt}){view.stuck.lastError !== null && <> — {view.stuck.lastError}</>}. It
          won't progress until the problem is fixed, then it resumes where it stopped. The status below is the
          last one it recorded.
        </div>
      )}
      <StatusHeader view={view} />
      <RunControls view={view} />
      <AgentTable agents={view.agents} />
      {HAS_DOMAINS.includes(view.status) && <DomainList runId={view.id} status={view.status} />}
    </>
  );
}

function StatusHeader({ view }: { view: RunView }) {
  const { counts } = view;
  return (
    <section>
      <h1>{view.domain}</h1>
      <p>
        <span className="status" data-testid="run-status">
          {RUN_STATUS_LABEL[view.status]}
        </span>
        {view.pending !== null && <span data-testid="run-pending"> — {PENDING_LABEL[view.pending]}</span>}
      </p>
      <p data-testid="run-counts">
        {counts.completed} of {view.agentCount} completed, {counts.running} running, {counts.queued} queued
        {counts.lost > 0 && `, ${counts.lost} lost`}
        {counts.failed > 0 && `, ${counts.failed} failed`}
        {counts.stopped > 0 && `, ${counts.stopped} stopped`} · window {view.window}
      </p>
      {view.summary !== null && (
        <div className="summary" data-testid="run-summary">
          <span>{view.summary.uniqueDomains} unique subdomains</span>
          <span className="risk-CRITICAL">{view.summary.critical} critical</span>
          <span className="risk-HIGH">{view.summary.high} high</span>
          <span className="risk-MEDIUM">{view.summary.medium} medium</span>
          <span className="risk-LOW">{view.summary.low} low</span>
        </div>
      )}
      {view.failure !== null && (
        <p className="errors" data-testid="run-failure">
          {FAILURE_LABEL[view.failure.code]}: {view.failure.detail}
        </p>
      )}
    </section>
  );
}
