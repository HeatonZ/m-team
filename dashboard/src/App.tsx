import { useState, useCallback } from 'react';
import type { Task, TaskStatus } from './types/task';
import { Header } from './components/Header';
import { TaskColumn } from './components/TaskColumn';
import { HistoryTab } from './components/HistoryTab';
import { LogsTab } from './components/LogsTab';
import { TaskDetailModal } from './components/TaskDetailModal';
import { usePendingTasks, useRunningTasks, useHistoryTasks } from './hooks/useTasks';
import { fetchTaskDetail } from './api/client';

type MainTab = 'board' | 'logs';

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeHistoryStatus, setActiveHistoryStatus] = useState<TaskStatus>('completed');

  const { tasks: pendingTasks, reload: reloadPending } = usePendingTasks();
  const { tasks: runningTasks, reload: reloadRunning } = useRunningTasks();
  const { tasks: historyTasks, reload: reloadHistory, page: historyPage, totalPages: historyTotalPages, total: historyTotal, setPage: setHistoryPage } = useHistoryTasks(activeHistoryStatus);

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

      <div className="tab-bar" style={{ marginBottom: '1rem' }}>
        <button className={`tab${mainTab === 'board' ? ' active' : ''}`} onClick={() => setMainTab('board')}>
          看板
        </button>
        <button className={`tab${mainTab === 'logs' ? ' active' : ''}`} onClick={() => setMainTab('logs')}>
          日志
        </button>
      </div>

      {mainTab === 'board' && (
        <>
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
            page={historyPage}
            totalPages={historyTotalPages}
            total={historyTotal}
            onPageChange={setHistoryPage}
          />
        </>
      )}

      {mainTab === 'logs' && <LogsTab />}

      <TaskDetailModal task={selectedTask} onClose={handleCloseModal} onUpdate={(updated) => { handleRefresh(); setSelectedTask(updated); }} />
    </div>
  );
}
