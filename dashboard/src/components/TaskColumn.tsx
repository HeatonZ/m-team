import type { FC, ReactNode } from 'react';
import type { Task } from '../types/task';
import { TaskCard } from './TaskCard';

interface TaskColumnProps {
  title: string;
  subtitle?: string;
  tasks: Task[];
  onCardClick: (taskId: string) => void;
  variant?: 'ready' | 'handoff' | 'reworking' | 'executing' | 'finalizing' | 'risk';
  emptyText?: string;
  cardDecorator?: (task: Task) => ReactNode;
}

export const TaskColumn: FC<TaskColumnProps> = ({ title, subtitle, tasks, onCardClick, variant = 'ready', emptyText = '暂无任务', cardDecorator }) => {
  return (
    <div className={`section section-card section-${variant}`}>
      <div className="section-header">
        <div>
          <h2>
            {title} <span className="section-count">{tasks.length}</span>
          </h2>
          {subtitle && <div className="section-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty">{emptyText}</div>
        ) : (
          tasks.map((t) => (
            <TaskCard key={t.taskId} task={t} onClick={onCardClick} decorator={cardDecorator?.(t)} />
          ))
        )}
      </div>
    </div>
  );
};
