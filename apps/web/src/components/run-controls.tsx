'use client';

import { RunAction, type RunView } from '@novee/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../lib/api-client';

type Request = typeof RunAction.Approve | typeof RunAction.Reject | typeof RunAction.Cancel;

/** Buttons follow `allowedActions` from the last poll (the API decides, D13), and are off while a request is in flight. */
export function RunControls({ view }: { view: RunView }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['run', view.id] });

  const request = useMutation({
    mutationFn: (action: Request) => {
      switch (action) {
        case RunAction.Approve:
          return apiClient.approve(view.id);
        case RunAction.Reject:
          return apiClient.reject(view.id);
        case RunAction.Cancel:
          return apiClient.cancel(view.id);
      }
    },
    onSettled: refresh,
  });
  const windowChange = useMutation({
    mutationFn: (size: number) => apiClient.setWindow(view.id, size),
    onSettled: refresh,
  });
  const [windowSize, setWindowSize] = useState(String(view.window));

  const busy = request.isPending || windowChange.isPending;
  const allowed = (action: RunAction) => view.allowedActions.includes(action) && !busy;
  if (view.allowedActions.length === 0 && !busy && request.error === null && windowChange.error === null)
    return null;

  return (
    <section>
      <div className="row">
        <button
          type="button"
          data-testid="action-approve"
          disabled={!allowed(RunAction.Approve)}
          onClick={() => request.mutate(RunAction.Approve)}
        >
          Approve
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="action-reject"
          disabled={!allowed(RunAction.Reject)}
          onClick={() => request.mutate(RunAction.Reject)}
        >
          Reject
        </button>
        <button
          type="button"
          className="danger"
          data-testid="action-cancel"
          disabled={!allowed(RunAction.Cancel)}
          onClick={() => request.mutate(RunAction.Cancel)}
        >
          Cancel run
        </button>
        <label>
          Window (1–{view.agentCount})
          <input
            type="number"
            data-testid="window-input"
            value={windowSize}
            onChange={(event) => setWindowSize(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          data-testid="action-window"
          disabled={!allowed(RunAction.SetWindow) || Number(windowSize) === view.window}
          onClick={() => windowChange.mutate(Number(windowSize))}
        >
          Set window
        </button>
      </div>
      {request.error !== null && <p className="errors">{request.error.message}</p>}
      {windowChange.error !== null && <p className="errors">{windowChange.error.message}</p>}
    </section>
  );
}
