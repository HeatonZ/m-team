import { useState, useEffect, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import { fetchLogs, type TaskLog } from '../api/logs';

const ACTION_COLORS: Record<string, string> = {
  publish: '#10b981',
  claim: '#3b82f6',
  next: '#f59e0b',
  complete: '#22c55e',
  fail: '#ef4444',
  reject: '#f97316',
  cancel: '#6b7280',
  close: '#8b5cf6',
  relinquish: '#64748b',
};

const ACTION_LABELS: Record<string, string> = {
  publish: 'Publish',
  claim: 'Claim',
  next: 'Next',
  complete: 'Complete',
  fail: 'Fail',
  reject: 'Reject',
  cancel: 'Cancel',
  close: 'Close',
  relinquish: 'Relinquish',
};

type DecisionFilter = '' | 'next' | 'complete' | 'fail';
type ViaFilter = '' | 'llm' | 'llm_fail_fast' | 'llm_repeat_guard';
type LlmStatusFilter = '' | 'ok' | 'error';
type ErrorFilter = 'all' | 'yes' | 'no';

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

function getReason(log: TaskLog): string {
  if (log.decision?.reason) return log.decision.reason;
  if (log.error) return log.error;

  const details = getResultDetails(log.result);
  if (!details) return '-';

  const candidate = details.reason ?? details.error ?? details.message;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  if (details.success === true) return 'success';
  if (details.success === false) return 'failed';
  return '-';
}

function getDecisionCell(log: TaskLog) {
  const decision = log.decision;
  if (!decision) {
    return <span className="mono">-</span>;
  }

  return (
    <div className="log-cell-stack">
      {decision.decision && <span className={`decision-badge decision-${decision.decision}`}>{decision.decision}</span>}
      {decision.via && <span className="decision-badge decision-via">{decision.via}</span>}
      {decision.nextTaskType && <span className="decision-badge decision-type">{decision.nextTaskType}</span>}
    </div>
  );
}

function getLlmCell(log: TaskLog) {
  const decision = log.decision;
  if (!decision || !decision.llmStatus) {
    return <span className="mono">-</span>;
  }

  const attempts = decision.llmAttempts ?? '-';
  const label = `${decision.llmStatus} · ${attempts} attempt${attempts === 1 ? '' : 's'}`;
  return (
    <div className="log-cell-stack">
      <span className={`decision-badge ${decision.llmStatus === 'ok' ? 'decision-ok' : 'decision-error'}`}>
        {label}
      </span>
      {decision.llmError ? <span className="log-mini-text" title={decision.llmError}>{decision.llmError}</span> : null}
      {decision.hasFallback ? <span className="decision-badge decision-fallback">fallback</span> : null}
    </div>
  );
}

function renderDecisionDetails(log: TaskLog) {
  const details = getResultDetails(log.result);
  if (!details) return null;

  return (
    <details className="log-details">
      <summary>Details</summary>
      <div className="log-detail-grid">
        <div><strong>Action</strong><span>{log.action}</span></div>
        <div><strong>Reason</strong><span>{getReason(log)}</span></div>
        <div><strong>Decision</strong><span>{asText(log.decision?.decision)}</span></div>
        <div><strong>Via</strong><span>{asText(log.decision?.via)}</span></div>
        <div><strong>Next step</strong><span>{asText(log.decision?.nextDescription)}</span></div>
        <div><strong>LLM</strong><span>{asText({ status: log.decision?.llmStatus, attempts: log.decision?.llmAttempts, error: log.decision?.llmError })}</span></div>
        <div><strong>Params</strong><pre>{asText(log.params)}</pre></div>
        <div><strong>Result</strong><pre>{asText(details)}</pre></div>
      </div>
    </details>
  );
}

export const LogsTab: FC = () => {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(false);

  const [inputTaskId, setInputTaskId] = useState('');
  const [inputAgentId, setInputAgentId] = useState('');
  const [inputKeyword, setInputKeyword] = useState('');

  const [filterTaskId, setFilterTaskId] = useState('');
  const [filterAgentId, setFilterAgentId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDecision, setFilterDecision] = useState<DecisionFilter>('');
  const [filterVia, setFilterVia] = useState<ViaFilter>('');
  const [filterLlmStatus, setFilterLlmStatus] = useState<LlmStatusFilter>('');
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const hasErrorFilter = errorFilter === 'all' ? undefined : errorFilter === 'yes';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLogs({
        taskId: filterTaskId || undefined,
        action: filterAction || undefined,
        agentId: filterAgentId || undefined,
        decision: filterDecision || undefined,
        via: filterVia || undefined,
        llmStatus: filterLlmStatus || undefined,
        hasError: hasErrorFilter,
        keyword: filterKeyword || undefined,
        page,
        pageSize,
      });
      setLogs(data.logs);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } finally {
      setLoading(false);
    }
  }, [
    filterTaskId,
    filterAction,
    filterAgentId,
    filterDecision,
    filterVia,
    filterLlmStatus,
    hasErrorFilter,
    filterKeyword,
    page,
    pageSize,
  ]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilterTaskId(inputTaskId.trim());
    setFilterAgentId(inputAgentId.trim());
    setFilterKeyword(inputKeyword.trim());
  };

  const handleReset = () => {
    setInputTaskId('');
    setInputAgentId('');
    setInputKeyword('');
    setFilterTaskId('');
    setFilterAgentId('');
    setFilterKeyword('');
    setFilterAction('');
    setFilterDecision('');
    setFilterVia('');
    setFilterLlmStatus('');
    setErrorFilter('all');
    setPage(1);
  };

  const insights = useMemo(() => {
    const llmErrors = logs.filter((log) => log.decision?.llmStatus === 'error').length;
    const fails = logs.filter((log) => log.action === 'fail').length;
    const errors = logs.filter((log) => Boolean(log.error)).length;
    const nextDecisions = logs.filter((log) => log.decision?.decision === 'next').length;
    return { llmErrors, fails, errors, nextDecisions };
  }, [logs]);

  return (
    <div className="section section-card">
      <div className="section-header">
        <div>
          <h2>Operation logs <span className="section-count">{total}</span></h2>
          <div className="section-subtitle">Trace publish / claim / next / complete / fail decisions with LLM visibility.</div>
        </div>
      </div>

      <div className="log-kpi-row">
        <div className="log-kpi-card"><span>Current page</span><strong>{logs.length}</strong></div>
        <div className="log-kpi-card"><span>Fail actions</span><strong>{insights.fails}</strong></div>
        <div className="log-kpi-card"><span>LLM errors</span><strong>{insights.llmErrors}</strong></div>
        <div className="log-kpi-card"><span>Explicit errors</span><strong>{insights.errors}</strong></div>
        <div className="log-kpi-card"><span>Next decisions</span><strong>{insights.nextDecisions}</strong></div>
      </div>

      <form onSubmit={handleSearch} className="log-search-grid">
        <input
          type="text"
          placeholder="taskId"
          value={inputTaskId}
          onChange={(e) => setInputTaskId(e.target.value)}
          className="log-input"
        />
        <input
          type="text"
          placeholder="agentId"
          value={inputAgentId}
          onChange={(e) => setInputAgentId(e.target.value)}
          className="log-input"
        />
        <input
          type="text"
          placeholder="keyword (reason / step / file)"
          value={inputKeyword}
          onChange={(e) => setInputKeyword(e.target.value)}
          className="log-input"
        />
        <button type="submit" className="tab">Apply</button>
        <button type="button" onClick={handleReset} className="tab">Reset</button>
        <button type="button" onClick={load} className="tab">Refresh</button>
      </form>

      <div className="log-toolbar">
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

        <select
          value={filterDecision}
          onChange={(e) => { setPage(1); setFilterDecision(e.target.value as DecisionFilter); }}
          className="log-select"
        >
          <option value="">All decisions</option>
          <option value="next">Next</option>
          <option value="complete">Complete</option>
          <option value="fail">Fail</option>
        </select>

        <select
          value={filterVia}
          onChange={(e) => { setPage(1); setFilterVia(e.target.value as ViaFilter); }}
          className="log-select"
        >
          <option value="">All via</option>
          <option value="llm">llm</option>
          <option value="llm_fail_fast">llm_fail_fast</option>
          <option value="llm_repeat_guard">llm_repeat_guard</option>
        </select>

        <select
          value={filterLlmStatus}
          onChange={(e) => { setPage(1); setFilterLlmStatus(e.target.value as LlmStatusFilter); }}
          className="log-select"
        >
          <option value="">All LLM status</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
        </select>

        <select
          value={errorFilter}
          onChange={(e) => { setPage(1); setErrorFilter(e.target.value as ErrorFilter); }}
          className="log-select"
        >
          <option value="all">All error state</option>
          <option value="yes">With error</option>
          <option value="no">Without error</option>
        </select>
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
                <th>Agent</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>LLM</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={log.error ? 'log-row-error' : undefined}>
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
                  <td>{getDecisionCell(log)}</td>
                  <td>
                    <div className="log-reason" title={getReason(log)}>{getReason(log)}</div>
                    {renderDecisionDetails(log)}
                  </td>
                  <td>{getLlmCell(log)}</td>
                  <td className="mono truncate" title={log.sessionKey ?? ''}>{log.sessionKey ?? '-'}</td>
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
