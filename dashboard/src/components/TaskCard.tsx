import type { FC, ReactNode } from 'react';
import type { Task } from '../types/task';
import { PRIORITY_LABELS, STATUS_LABELS, PHASE_LABELS } from '../types/task';
import { formatTime, escHtml } from '../utils/format';

interface TaskCardProps {
  task: Task;
  onClick: (taskId: string) => void;
  decorator?: ReactNode;
}

function getLatestStep(task: Task) {
  return [...task.context].reverse().find((entry) => entry.output?.summary || entry.output?.handoffNote || entry.output?.completionNote);
}

function getRiskText(task: Task): string | null {
  const guard = task.lifecycle?.loopGuard;
  if (!guard) return null;
  if (guard.noProgressCount >= 2) return '无进展';
  if (guard.sameDescriptionCount >= 2) return '重复描述';
  if (guard.samePhaseCount >= 3) return '停留过久';
  return null;
}

function getFreshness(task: Task): { label: string; className: string } {
  const ageMinutes = Math.max(0, (Date.now() - task.updatedAt) / 60_000);
  if (ageMinutes < 10) return { label: '新鲜', className: 'freshness-fresh' };
  if (ageMinutes < 30) return { label: '变老', className: 'freshness-aging' };
  return { label: '滞留', className: 'freshness-stale' };
}

export const TaskCard: FC<TaskCardProps> = ({ task, onClick, decorator }) => {
  const latest = getLatestStep(task);
  const phaseLabel = PHASE_LABELS[task.lifecycle.phase];
  const riskText = getRiskText(task);
  const freshness = getFreshness(task);

  return (
    <div className={`task-card task-card-${task.lifecycle.phase} ${freshness.className}`} onClick={() => onClick(task.taskId)}>
      <div className="task-header task-header-top">
        <span className="task-type-badge">{task.taskType || 'general'}</span>
        <span className={`phase-badge phase-${task.lifecycle.phase}`}>{phaseLabel}</span>
        <span className={`freshness-badge ${freshness.className}`}>{freshness.label}</span>
        {riskText && <span className="risk-badge">⚠ {riskText}</span>}
      </div>

      <div className="task-description">{escHtml(task.description)}</div>
      <div className="task-goal-muted">目标：{escHtml(task.goal)}</div>

      <div className="task-summary-card">
        <div className="task-summary-label">最新交接</div>
        <div className="task-summary-text">
          {decorator || latest?.output?.handoffNote || latest?.output?.summary || latest?.output?.completionNote || '暂无交接摘要'}
        </div>
      </div>

      <div className="task-meta">
        <span className={`status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
        <span>{PRIORITY_LABELS[task.priority]}</span>
        <span>📢 {escHtml(task.publisher)}</span>
        {task.executor && <span>⚙️ {escHtml(task.executor)}</span>}
        {!task.executor && task.lastExecutor && <span>🧩 {escHtml(task.lastExecutor)}</span>}
        <span>🔁 {task.lifecycle.handoffCount}</span>
        <span>🛠️ {task.lifecycle.reworkCount}</span>
        {task.updatedAt && <span>💚 {formatTime(task.updatedAt)}</span>}
      </div>
    </div>
  );
};
