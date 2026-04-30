import { type FC } from 'react';
import type { Task } from '../types/task';
import { TaskCard } from './TaskCard';

interface CurrentTasksProps {
  pending: Task[];
  running: Task[];
  onSelectTask: (taskId: string) => void;
}

type Tab = 'pending' | 'running';

export default function CurrentTasks({ pending, running, onSelectTask }: CurrentTasksProps) {
  const [tab, setTab] = useState<Tab>('pending');
  const tasks = tab === 'pending' ? pending : running;
  const label = tab === 'pending' ? '待认领' : '执行中';
  const emoji = tab === 'pending' ? '⏳' : '⚙️';

  return (
    <div className="section">
      <h2>{emoji} {label} (<span id={`${tab}-count`}>{tasks.length}</span>)</h2>
      <div className="tab-bar">
        <button
          className={`tab ${tab === 'pending' ? 'active' : ''}`}
          onClick={() => setTab('pending')}
        >
          ⏳ 待认领 ({pending.length})
        </button>
        <button
          className={`tab ${tab === 'running' ? 'active' : ''}`}
          onClick={() => setTab('running')}
        >
          ⚙️ 执行中 ({running.length})
        </button>
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty">暂无{tab === 'pending' ? '待认领' : '执行中'}任务</div>
        ) : (
          tasks.map(t => (
            <TaskCard key={t.taskId} task={t} onClick={() => onSelectTask(t.taskId)} />
          ))
        )}
      </div>
    </div>
  );
}
