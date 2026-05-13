import type { FC } from 'react';
import type { Task, TaskStatus } from '../types/task';
import { STATUS_LABELS, HISTORY_STATUSES } from '../types/task';
import { TaskCard } from './TaskCard';

interface HistoryTabProps {
  activeStatus: TaskStatus;
  tasks: Task[];
  onStatusChange: (s: TaskStatus) => void;
  onCardClick: (taskId: string) => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}

export const HistoryTab: FC<HistoryTabProps> = ({
  activeStatus,
  tasks,
  onStatusChange,
  onCardClick,
  page,
  totalPages,
  total,
  onPageChange,
}) => {
  return (
    <div className="section">
      <h2>
        History <span style={{ fontWeight: 'normal', fontSize: '0.8em' }}>({total})</span>
      </h2>
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
          <div className="empty">No history records</div>
        ) : (
          tasks.map((t) => (
            <TaskCard key={t.taskId} task={t} onClick={onCardClick} />
          ))
        )}
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="tab"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Prev
          </button>
          <span className="page-info">{page} / {totalPages}</span>
          <button
            className="tab"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
