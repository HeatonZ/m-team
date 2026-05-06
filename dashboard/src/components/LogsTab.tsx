import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import { fetchLogs, type TaskLog } from '../api/logs';

const ACTION_COLORS: Record<string, string> = {
  publish: '#10b981',
  claim: '#3b82f6',
  relay: '#f59e0b',
  complete: '#22c55e',
  fail: '#ef4444',
  cancel: '#6b7280',
  close: '#8b5cf6',
  relinquish: '#6b7280',
};

const ACTION_LABELS: Record<string, string> = {
  publish: '发布',
  claim: '认领',
  relay: '交接',
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

export const LogsTab: FC = () => {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterTaskId, setFilterTaskId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [inputTaskId, setInputTaskId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLogs(
        filterTaskId || undefined,
        filterAction || undefined
      );
      setLogs(data);
    } finally {
      setLoading(false);
    }
  }, [filterTaskId, filterAction]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilterTaskId(inputTaskId.trim());
  };

  return (
    <div className="section">
      <h2>📋 操作日志 <span style={{ fontWeight: 'normal', fontSize: '0.8em' }}>({logs.length}条)</span></h2>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="按任务ID过滤"
            value={inputTaskId}
            onChange={e => setInputTaskId(e.target.value)}
            style={{ padding: '0.3rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', width: '180px' }}
          />
          <button type="submit" className="tab">搜索</button>
        </form>

        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          style={{ padding: '0.3rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px' }}
        >
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button onClick={() => { setInputTaskId(''); setFilterTaskId(''); setFilterAction(''); }} className="tab">
          重置
        </button>

        <button onClick={load} className="tab" style={{ marginLeft: 'auto' }}>
          刷新
        </button>
      </div>

      {loading && <div className="empty">加载中...</div>}

      {!loading && logs.length === 0 && <div className="empty">暂无日志</div>}

      {!loading && logs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>时间</th>
                <th style={{ padding: '0.5rem' }}>操作</th>
                <th style={{ padding: '0.5rem' }}>任务ID</th>
                <th style={{ padding: '0.5rem' }}>agentId</th>
                <th style={{ padding: '0.5rem' }}>sessionKey</th>
                <th style={{ padding: '0.5rem' }}>结果</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>{formatTime(log.createdAt)}</td>
                  <td style={{ padding: '0.4rem' }}>
                    <span style={{
                      background: ACTION_COLORS[log.action] ?? '#6b7280',
                      color: '#fff',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8em'
                    }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.4rem', fontFamily: 'monospace' }}>{log.taskId}</td>
                  <td style={{ padding: '0.4rem' }}>{log.agentId ?? '-'}</td>
                  <td style={{ padding: '0.4rem', fontFamily: 'monospace', fontSize: '0.8em', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.sessionKey ?? ''}>
                    {log.sessionKey ?? '-'}
                  </td>
                  <td style={{ padding: '0.4rem' }}>
                    {log.result ? (
                      log.result.success ? (
                        <span style={{ color: '#22c55e' }}>✓ {log.result.reason ?? ''}</span>
                      ) : (
                        <span style={{ color: '#ef4444' }}>✗ {log.result.reason ?? ''}</span>
                      )
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
