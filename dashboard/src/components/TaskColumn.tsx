import type { FC, ReactNode } from 'react';
import type { Task } from '../types/task';
import { TaskCard } from './TaskCard';

interface TaskColumnProps {
  title: string;
  subtitle?: string;
  tasks: Task[];
  onCardClick: (taskId: string) => void;
  variant?: 'new' | 'next' | 'blocked' | 'running' | 'risk';
  emptyText?: string;
  cardDecorator?: (task: Task) => ReactNode;
}

export const TaskColumn: FC<TaskColumnProps> = ({
  title,
  subtitle,
  tasks,
  onCardClick,
  variant = 'new',
  emptyText = 'No tasks',
  cardDecorator,
}) => {
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
          tasks.map((task) => (
            <TaskCard key={task.taskId} task={task} onClick={onCardClick} decorator={cardDecorator?.(task)} />
          ))
        )}
      </div>
    </div>
  );
};
