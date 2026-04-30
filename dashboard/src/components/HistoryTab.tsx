import type { FC } from 'react';
import type { Task, TaskStatus } from '../types/task';
import { STATUS_LABELS, HISTORY_STATUSES } from '../types/task';
import { TaskCard } from './TaskCard';

interface HistoryTabProps {
  activeStatus: TaskStatus;
  tasks: Task[];
  onStatusChange: (s: TaskStatus) => void;
  onCardClick: (taskId: string) => void;
}

export const HistoryTab: FC<HistoryTabProps> = ({
  activeStatus,
  tasks,
  onStatusChange,
  onCardClick,
}) => {
  return (
    <div className="section">
      <h2>📜 历史记录</h2>
      <div className="tab-bar">
        {HISTORY_STATUSES.map((s) => (
          <button
            key={s}
            className={`tab${activeStatus === s ? ' active' : ''}`}
            onClick={() => onStatusChange(s)}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty">暂无历史记录</div>
        ) : (
          tasks.map((t) => (
            <TaskCard key={t.taskId} task={t} onClick={onCardClick} />
          ))
        )}
      </div>
    </div>
  );
};
