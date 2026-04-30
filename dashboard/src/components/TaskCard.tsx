import type { FC } from 'react';
import type { Task } from '../types/task';
import { PRIORITY_LABELS, STATUS_LABELS } from '../types/task';
import { formatTime, escHtml } from '../utils/format';

interface TaskCardProps {
  task: Task;
  onClick: (taskId: string) => void;
}

export const TaskCard: FC<TaskCardProps> = ({ task, onClick }) => {
  return (
    <div className="task-card" onClick={() => onClick(task.taskId)}>
      <div className="task-header">
        <span className="task-goal">{task.goal}</span>
      </div>
      <div className="task-meta">
        <span className={`status-${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
        <span>{PRIORITY_LABELS[task.priority]}</span>
        <span>📢 {escHtml(task.publisher)}</span>
        {task.executor && <span>⚙️ {escHtml(task.executor)}</span>}
        {task.lastHeartbeatAt && (
          <span>💚 {formatTime(task.lastHeartbeatAt)}</span>
        )}
        {task.completedAt && (
          <span>🏁 {formatTime(task.completedAt)}</span>
        )}
      </div>
    </div>
  );
};
