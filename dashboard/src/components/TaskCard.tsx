import type { FC, ReactNode } from 'react';
import type { Task } from '../types/task';
import { PRIORITY_LABELS, STATUS_LABELS, TASK_TYPE_LABELS } from '../types/task';
import { formatRelativeTime, formatTime, escHtml } from '../utils/format';

interface TaskCardProps {
  task: Task;
  onClick: (taskId: string) => void;
  decorator?: ReactNode;
}

function getLatestStep(task: Task) {
  return [...task.context].reverse().find((entry) => entry.type === 'step');
}

function getNextKind(task: Task): 'new' | 'next' | 'blocked' | 'running' | 'terminal' {
  if (task.status === 'running') return 'running';
  if (task.status !== 'pending') return 'terminal';
  if (task.context.length === 0) return 'new';
  const issues = getLatestStep(task)?.output?.unresolvedIssues ?? [];
  if (issues.some((issue) => ['blocked', 'permission', 'external', '阻塞', '权限', '外部'].some((token) => issue.toLowerCase().includes(token.toLowerCase())))) return 'blocked';
  return 'next';
}

function getLatestSummary(task: Task): string {
  const latest = getLatestStep(task);
  return latest?.output?.summary || latest?.step || 'No latest summary';
}

function getLatestIssues(task: Task): string[] {
  return getLatestStep(task)?.output?.unresolvedIssues ?? [];
}

export const TaskCard: FC<TaskCardProps> = ({ task, onClick, decorator }) => {
  const latest = getLatestStep(task);
  const nextKind = getNextKind(task);
  const latestIssues = getLatestIssues(task);
  const latestFiles = latest?.output?.files ?? [];

  return (
    <div className={`task-card task-card-${nextKind}`} onClick={() => onClick(task.taskId)}>
      <div className="task-header task-header-top">
        <span className="task-type-badge">{TASK_TYPE_LABELS[task.taskType || 'general']}</span>
        <span className={`status-chip status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
        <span className={`flow-chip flow-${nextKind}`}>
          {nextKind === 'new' && 'New task'}
          {nextKind === 'next' && 'Next step queued'}
          {nextKind === 'blocked' && 'Blocked'}
          {nextKind === 'running' && 'Running'}
          {nextKind === 'terminal' && 'Terminal'}
        </span>
      </div>

      <div className="task-description">{escHtml(task.description)}</div>

      <div className="task-summary-card">
        <div className="task-summary-label">Latest summary</div>
        <div className="task-summary-text">{decorator || getLatestSummary(task)}</div>
      </div>

      {latestIssues.length > 0 && (
        <div className="task-issues">
          <div className="task-summary-label">Open issues</div>
          <div className="pill-row">
            {latestIssues.slice(0, 3).map((issue, idx) => (
              <span className="issue-pill" key={`${issue}-${idx}`}>{issue}</span>
            ))}
          </div>
        </div>
      )}

      {latestFiles.length > 0 && (
        <div className="task-files">
          <div className="task-summary-label">Latest outputs</div>
          <div className="file-list">{latestFiles.slice(0, 2).join(' · ')}</div>
        </div>
      )}

      <div className="task-meta">
        <span>{PRIORITY_LABELS[task.priority]}</span>
        <span>Publisher {escHtml(task.publisher)}</span>
        {task.executor && <span>Executor {escHtml(task.executor)}</span>}
        {!task.executor && task.lastExecutor && <span>Last {escHtml(task.lastExecutor)}</span>}
        <span>{formatRelativeTime(task.updatedAt)}</span>
        <span title={formatTime(task.updatedAt)}>#{task.taskId.slice(-6)}</span>
      </div>
    </div>
  );
};
