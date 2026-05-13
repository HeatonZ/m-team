import { useMemo, useState, useCallback } from 'react';
import type { Task, TaskStatus } from './types/task';
import { STATUS_LABELS } from './types/task';
import { Header } from './components/Header';
import { TaskColumn } from './components/TaskColumn';
import { HistoryTab } from './components/HistoryTab';
import { LogsTab } from './components/LogsTab';
import { TaskDetailModal } from './components/TaskDetailModal';
import { usePendingTasks, useRunningTasks, useHistoryTasks } from './hooks/useTasks';
import { fetchTaskDetail } from './api/client';
import { getHeatBucket, getLatestSummary, isBlockedTask } from './utils/task';

type MainTab = 'board' | 'logs';
type BoardFilter = 'all' | 'needs_next' | 'blocked' | 'fresh';

const FILTER_LABELS: Record<BoardFilter, string> = {
  all: 'All',
  needs_next: 'Needs next step',
  blocked: 'Blocked only',
  fresh: 'Updated in 10m',
};

function filterTasks(tasks: Task[], filter: BoardFilter) {
  return tasks.filter((task) => {
    if (filter === 'all') return true;
    if (filter === 'fresh') return getHeatBucket(task.updatedAt) === 'fresh';
    if (filter === 'blocked') return isBlockedTask(task);
    if (filter === 'needs_next') return task.status === 'pending' && task.context.length > 0;
    return true;
  });
}

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>('board');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeHistoryStatus, setActiveHistoryStatus] = useState<TaskStatus>('completed');
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');

  const { tasks: pendingTasks, reload: reloadPending } = usePendingTasks();
  const { tasks: runningTasks, reload: reloadRunning } = useRunningTasks();
  const {
    tasks: historyTasks,
    reload: reloadHistory,
    page: historyPage,
    totalPages: historyTotalPages,
    total: historyTotal,
    setPage: setHistoryPage,
  } = useHistoryTasks(activeHistoryStatus);

  const handleRefresh = useCallback(() => {
    reloadPending();
    reloadRunning();
    reloadHistory();
  }, [reloadPending, reloadRunning, reloadHistory]);

  const handleCardClick = useCallback(async (taskId: string) => {
    try {
      const task = await fetchTaskDetail(taskId);
      setSelectedTask(task);
    } catch (err) {
      console.error('Failed to load task detail:', err);
    }
  }, []);

  const board = useMemo(() => {
    const filteredPending = filterTasks(pendingTasks, boardFilter);
    const filteredRunning = filterTasks(runningTasks, boardFilter);

    const newTasks = filteredPending.filter((task) => task.context.length === 0);
    const queuedNext = filteredPending.filter((task) => task.context.length > 0 && !isBlockedTask(task));
    const blockedNext = filteredPending.filter((task) => task.context.length > 0 && isBlockedTask(task));
    const activeWork = filteredRunning;
    const risky = [...filteredPending, ...filteredRunning].filter((task) => isBlockedTask(task) || getHeatBucket(task.updatedAt) === 'stale');

    return { newTasks, queuedNext, blockedNext, activeWork, risky };
  }, [pendingTasks, runningTasks, boardFilter]);

  const stats = useMemo(
    () => ({
      totalActive: pendingTasks.length + runningTasks.length,
      waitingNext: pendingTasks.filter((task) => task.context.length > 0).length,
      blocked: [...pendingTasks, ...runningTasks].filter(isBlockedTask).length,
      running: runningTasks.length,
      fresh: [...pendingTasks, ...runningTasks].filter((task) => getHeatBucket(task.updatedAt) === 'fresh').length,
    }),
    [pendingTasks, runningTasks],
  );

  const spotlight = useMemo(() => {
    return [...pendingTasks, ...runningTasks]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
      .map((task) => ({
        taskId: task.taskId,
        status: task.status,
        summary: getLatestSummary(task),
        heat: getHeatBucket(task.updatedAt),
      }));
  }, [pendingTasks, runningTasks]);

  return (
    <div className="container">
      <Header onRefresh={handleRefresh} />

      <div className="hero-panel">
        <div>
          <div className="hero-eyebrow">M-Team Task Loop</div>
          <h2 className="hero-title">Closed-loop Collaboration Board</h2>
          <p className="hero-subtitle">
            Follow each task through next / complete / fail decisions with clear focus, blockers, and acceptance history.
          </p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card"><span>Active tasks</span><strong>{stats.totalActive}</strong></div>
          <div className="hero-stat-card"><span>Waiting next</span><strong>{stats.waitingNext}</strong></div>
          <div className="hero-stat-card"><span>Running</span><strong>{stats.running}</strong></div>
          <div className="hero-stat-card hero-stat-card-warn"><span>Blocked</span><strong>{stats.blocked}</strong></div>
          <div className="hero-stat-card"><span>Updated in 10m</span><strong>{stats.fresh}</strong></div>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-group">
          <span className="toolbar-label">Board filter</span>
          {(Object.keys(FILTER_LABELS) as BoardFilter[]).map((key) => (
            <button
              key={key}
              className={`filter-chip${boardFilter === key ? ' active' : ''}`}
              onClick={() => setBoardFilter(key)}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="spotlight-panel">
        <div className="section-header">
          <div>
            <h2>Recent activity</h2>
            <div className="section-subtitle">Fast entry points for tasks that changed most recently.</div>
          </div>
        </div>
        <div className="spotlight-grid">
          {spotlight.map((item) => (
            <button key={item.taskId} className={`spotlight-card heat-${item.heat}`} onClick={() => handleCardClick(item.taskId)}>
              <span className={`status-chip status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
              <strong>{item.taskId.slice(-8)}</strong>
              <div>{item.summary}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: '1rem' }}>
        <button className={`tab${mainTab === 'board' ? ' active' : ''}`} onClick={() => setMainTab('board')}>Board</button>
        <button className={`tab${mainTab === 'logs' ? ' active' : ''}`} onClick={() => setMainTab('logs')}>Logs</button>
      </div>

      {mainTab === 'board' && (
        <>
          <div className="board-grid board-grid-top">
            <TaskColumn
              title="New tasks"
              subtitle="Published and waiting for the first claim"
              tasks={board.newTasks}
              onCardClick={handleCardClick}
              variant="new"
            />
            <TaskColumn
              title="Queued next steps"
              subtitle="agent_end produced next description; waiting for claim"
              tasks={board.queuedNext}
              onCardClick={handleCardClick}
              variant="next"
            />
            <TaskColumn
              title="Blocked next steps"
              subtitle="Latest step has unresolved issues to clear first"
              tasks={board.blockedNext}
              onCardClick={handleCardClick}
              variant="blocked"
            />
          </div>

          <div className="board-grid board-grid-bottom">
            <TaskColumn
              title="Running now"
              subtitle="Currently held by executor and being worked"
              tasks={board.activeWork}
              onCardClick={handleCardClick}
              variant="running"
            />
            <TaskColumn
              title="Risk watch"
              subtitle="Stale updates or unresolved blockers"
              tasks={board.risky}
              onCardClick={handleCardClick}
              variant="risk"
              emptyText="No risk tasks right now"
              cardDecorator={(task) => getLatestSummary(task)}
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

      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}
