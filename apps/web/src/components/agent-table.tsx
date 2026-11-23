import { AgentStatus, type AgentView } from '@novee/contracts';
import { AGENT_STATUS_LABEL, LOST_REASON_LABEL } from '../lib/labels';

export function AgentTable({ agents }: { agents: readonly AgentView[] }) {
  return (
    <section>
      <h2>Agents</h2>
      <div className="table-wrap">
        <table data-testid="agent-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Technique</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Found</th>
              <th>Worker</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.index}>
                <td>{agent.index}</td>
                <td>{agent.technique}</td>
                <td>{describeStatus(agent)}</td>
                <td>
                  <div className="bar" title={`${Math.round(agent.progress * 100)}%`}>
                    <span style={{ width: `${agent.progress * 100}%` }} />
                  </div>
                </td>
                <td>{agent.discoveredCount ?? '—'}</td>
                <td className="muted">{agent.worker ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function describeStatus(agent: AgentView): string {
  const parts = [AGENT_STATUS_LABEL[agent.status]];
  if (agent.lostReason !== null) parts.push(`(${LOST_REASON_LABEL[agent.lostReason]})`);
  if (agent.status !== AgentStatus.Completed && agent.stopConfirmed === false)
    parts.push('— stop unconfirmed');
  return parts.join(' ');
}
