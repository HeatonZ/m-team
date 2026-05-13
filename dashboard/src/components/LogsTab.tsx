import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import { fetchLogs, type TaskLog } from '../api/logs';

const ACTION_COLORS: Record<string, string> = {
  publish: '#10b981',
  claim: '#3b82f6',
  next: '#f59e0b',
  complete: '#22c55e',
  fail: '#ef4444',
  cancel: '#6b7280',
  close: '#8b5cf6',
  relinquish: '#6b7280',
};

const ACTION_LABELS: Record<string, string> = {
  publish: 'Publish',
  claim: 'Claim',
  next: 'Next',
  complete: 'Complete',
  fail: 'Fail',
  cancel: 'Cancel',
  close: 'Close',
  relinquish: 'Relinquish',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', { hour12: false });
}

function asText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function getResultDetails(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return null;
  const details = result.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  return result;
}

function renderResultSummary(log: TaskLog) {
  const details = getResultDetails(log.result);
  if (!details) return '-';

  const success = details.success;
  const reason = asText(details.reason ?? details.error);

  if (success === true) {
    return <span style={{ color: '#22c55e' }}>✓ {reason}</span>;
  }
  if (success === false) {
    return <span style={{ color: '#ef4444' }}>✗ {reason}</span>;
  }
  return <span>{reason}</span>;
}

function renderDecisionDetails(log: TaskLog) {
  const details = getResultDetails(log.result);
  if (!details || !['next', 'complete', 'fail'].includes(log.action)) return null;

  return (
    <details className="log-details">
      <summary>agent_end decision details</summary>
      <div className="log-detail-grid">
        <div><strong>Decision</strong><span>{asText(details.decision ?? log.action)}</span></div>
        <div><strong>Reason</strong><span>{asText(details.reason)}</span></div>
        <div><strong>Next step</strong><span>{asText(details.nextDescription)}</span></div>
        <div><strong>Evidence</strong><pre>{asText(details.evidence)}</pre></div>
      </div>
    </details>
  );
}

export const LogsTab: FC = () => {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterTaskId, setFilterTaskId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [inputTaskId, setInputTaskId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLogs({
        taskId: filterTaskId || undefined,
        action: filterAction || undefined,
        page,
        pageSize,
      });
      setLogs(data.logs);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } finally {
      setLoading(false);
    }
  }, [filterTaskId, filterAction, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilterTaskId(inputTaskId.trim());
  };

  return (
    <div className="section section-card">
      <div className="section-header">
        <div>
          <h2>Operation logs <span className="section-count">{total}</span></h2>
          <div className="section-subtitle">Inspect claim / next / complete / fail traces.</div>
        </div>
      </div>

      <div className="log-toolbar">
        <form onSubmit={handleSearch} className="log-search">
          <input
            type="text"
            placeholder="Filter by taskId"
            value={inputTaskId}
            onChange={(e) => setInputTaskId(e.target.value)}
            className="log-input"
          />
          <button type="submit" className="tab">Search</button>
        </form>

        <select
          value={filterAction}
          onChange={(e) => { setPage(1); setFilterAction(e.target.value); }}
          className="log-select"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <button onClick={() => { setInputTaskId(''); setFilterTaskId(''); setFilterAction(''); setPage(1); }} className="tab">
          Reset
        </button>

        <button onClick={load} className="tab" style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {loading && <div className="empty">Loading...</div>}
      {!loading && logs.length === 0 && <div className="empty">No logs</div>}

      {!loading && logs.length > 0 && (
        <div className="log-table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Task ID</th>
                <th>agentId</th>
                <th>sessionKey</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.createdAt)}</td>
                  <td>
                    <span
                      className="log-action-badge"
                      style={{ background: ACTION_COLORS[log.action] ?? '#6b7280' }}
                    >
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="mono">{log.taskId}</td>
                  <td>{log.agentId ?? '-'}</td>
                  <td className="mono truncate" title={log.sessionKey ?? ''}>{log.sessionKey ?? '-'}</td>
                  <td>
                    {renderResultSummary(log)}
                    {renderDecisionDetails(log)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button className="tab" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>Prev</button>
            <span className="page-info">Page {page} / {Math.max(1, totalPages)} · {logs.length} rows</span>
            <button className="tab" onClick={() => setPage((p) => Math.min(Math.max(1, totalPages), p + 1))} disabled={page >= Math.max(1, totalPages) || loading}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
};
