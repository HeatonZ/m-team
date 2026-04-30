import type { FC } from 'react';
import type { Task } from '../types/task';
import { TaskCard } from './TaskCard';

interface TaskColumnProps {
  title: string;
  tasks: Task[];
  onCardClick: (taskId: string) => void;
}

export const TaskColumn: FC<TaskColumnProps> = ({ title, tasks, onCardClick }) => {
  return (
    <div className="section">
      <h2>
        {title} (<span id={`${title}-count`}>{tasks.length}</span>)
      </h2>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty">暂无任务</div>
        ) : (
          tasks.map((t) => (
            <TaskCard key={t.taskId} task={t} onClick={onCardClick} />
          ))
        )}
      </div>
    </div>
  );
};
