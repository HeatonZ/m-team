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
  publish: '发布',
  claim: '认领',
  next: '下一步',
  complete: '完成',
  fail: '失败',
  cancel: '取消',
  close: '验收关闭',
  relinquish: '放弃',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
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
      <summary>agent_end 判决详情</summary>
      <div className="log-detail-grid">
        <div><strong>判决</strong><span>{asText(details.decision ?? log.action)}</span></div>
        <div><strong>原因</strong><span>{asText(details.reason)}</span></div>
        <div><strong>下一步</strong><span>{asText(details.nextDescription)}</span></div>
        <div><strong>证据摘要</strong><pre>{asText(details.evidence)}</pre></div>
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
          <h2>📋 操作日志 <span className="section-count">{total}</span></h2>
          <div className="section-subtitle">重点关注 claim / next / complete / fail 的连续轨迹。</div>
        </div>
      </div>

      <div className="log-toolbar">
        <form onSubmit={handleSearch} className="log-search">
          <input
            type="text"
            placeholder="按任务ID过滤"
            value={inputTaskId}
            onChange={(e) => setInputTaskId(e.target.value)}
            className="log-input"
          />
          <button type="submit" className="tab">搜索</button>
        </form>

        <select
          value={filterAction}
          onChange={(e) => { setPage(1); setFilterAction(e.target.value); }}
          className="log-select"
        >
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <button onClick={() => { setInputTaskId(''); setFilterTaskId(''); setFilterAction(''); setPage(1); }} className="tab">
          重置
        </button>

        <button onClick={load} className="tab" style={{ marginLeft: 'auto' }}>
          刷新
        </button>
      </div>

      {loading && <div className="empty">加载中...</div>}
      {!loading && logs.length === 0 && <div className="empty">暂无日志</div>}

      {!loading && logs.length > 0 && (
        <div className="log-table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>任务ID</th>
                <th>agentId</th>
                <th>sessionKey</th>
                <th>结果</th>
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
            <button className="tab" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>上一页</button>
            <span className="page-info">第 {page} 页 / 共 {Math.max(1, totalPages)} 页 · 本页 {logs.length} 条</span>
            <button className="tab" onClick={() => setPage((p) => Math.min(Math.max(1, totalPages), p + 1))} disabled={page >= Math.max(1, totalPages) || loading}>下一页</button>
          </div>
        </div>
      )}
    </div>
  );
};
