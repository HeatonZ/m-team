import { useState, useCallback } from 'react';
import type { Task, TaskStatus } from './types/task';
import { Header } from './components/Header';
import { TaskColumn } from './components/TaskColumn';
import { HistoryTab } from './components/HistoryTab';
import { TaskDetailModal } from './components/TaskDetailModal';
import { usePendingTasks, useRunningTasks, useHistoryTasks } from './hooks/useTasks';
import { fetchTaskDetail } from './api/client';

export function App() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeHistoryStatus, setActiveHistoryStatus] = useState<TaskStatus>('completed');

  const { tasks: pendingTasks, reload: reloadPending } = usePendingTasks();
  const { tasks: runningTasks, reload: reloadRunning } = useRunningTasks();
  const { tasks: historyTasks, reload: reloadHistory } = useHistoryTasks(activeHistoryStatus);

  const handleRefresh = useCallback(() => {
    reloadPending();
    reloadRunning();
    reloadHistory();
  }, [reloadPending, reloadRunning, reloadHistory]);

  const handleCardClick = useCallback(async (taskId: string) => {
    try {
      const task = await fetchTaskDetail(taskId);
      setSelectedTask(task);
      setSelectedTaskId(taskId);
    } catch (err) {
      console.error('Failed to load task detail:', err);
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedTask(null);
    setSelectedTaskId(null);
  }, []);

  return (
    <div className="container">
      <Header onRefresh={handleRefresh} />

      <div className="grid">
        <TaskColumn
          title="⏳ 待认领"
          tasks={pendingTasks}
          onCardClick={handleCardClick}
        />
        <TaskColumn
          title="⚙️ 执行中"
          tasks={runningTasks}
          onCardClick={handleCardClick}
        />
      </div>

      <HistoryTab
        activeStatus={activeHistoryStatus}
        tasks={historyTasks}
        onStatusChange={setActiveHistoryStatus}
        onCardClick={handleCardClick}
      />

      <TaskDetailModal task={selectedTask} onClose={handleCloseModal} onUpdate={(updated) => { handleRefresh(); setSelectedTask(updated); }} />
    </div>
  );
}
