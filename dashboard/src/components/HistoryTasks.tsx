import type { Task } from '../types/task';
import TaskCard from './TaskCard';

type HistoryStatus = 'completed' | 'failed' | 'cancelled';

interface HistoryTasksProps {
  tasks: Task[];
  filter: HistoryStatus;
  onFilterChange: (f: HistoryStatus) => void;
  onSelectTask: (taskId: string) => void;
}

const TABS: { key: HistoryStatus; label: string; emoji: string }[] = [
  { key: 'completed', label: '已完成', emoji: '✅' },
  { key: 'failed', label: '已失败', emoji: '❌' },
  { key: 'cancelled', label: '已取消', emoji: '🚫' },
];

export default function HistoryTasks({ tasks, filter, onFilterChange, onSelectTask }: HistoryTasksProps) {
  return (
    <div className="section">
      <h2>📜 历史记录</h2>
      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab ${filter === t.key ? 'active' : ''}`}
            onClick={() => onFilterChange(t.key)}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty">暂无历史记录</div>
        ) : (
          tasks.map(t => (
            <TaskCard key={t.taskId} task={t} onClick={() => onSelectTask(t.taskId)} />
          ))
        )}
      </div>
    </div>
  );
}
