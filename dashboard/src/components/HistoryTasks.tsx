import type { FC } from 'react';
import type { Task } from '../types/task';
import { TaskCard } from './TaskCard';

type HistoryStatus = 'completed' | 'failed' | 'cancelled';

interface HistoryTasksProps {
  tasks: Task[];
  filter: HistoryStatus;
  onSelectTask: (taskId: string) => void;
}

export const HistoryTasks: FC<HistoryTasksProps> = ({ tasks, filter, onSelectTask }) => {
  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <p>暂无{filter === 'completed' ? '已完成' : filter === 'failed' ? '失败' : '已取消'}的任务</p>
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map(t => (
        <TaskCard key={t.taskId} task={t} onClick={() => onSelectTask(t.taskId)} />
      ))}
    </div>
  );
};
