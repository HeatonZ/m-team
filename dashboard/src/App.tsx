import { useMemo, useState, useCallback } from 'react';
import type { Task, TaskStatus, TaskType } from './types/task';
import { STATUS_LABELS, TASK_TYPE_LABELS } from './types/task';
import { Header } from './components/Header';
import { TaskColumn } from './components/TaskColumn';
import { HistoryTab } from './components/HistoryTab';
import { LogsTab } from './components/LogsTab';
import { TaskDetailModal } from './components/TaskDetailModal';
import { usePendingTasks, useRunningTasks, useHistoryTasks } from './hooks/useTasks';
import { fetchTaskDetail } from './api/client';
import { getHeatBucket, getLatestSummary, getTaskRiskLevel, isBlockedTask } from './utils/task';

type MainTab = 'board' | 'logs';
type BoardFilter = 'all' | 'needs_next' | 'blocked' | 'fresh' | 'risky';
type TypeFilter = 'all' | TaskType;

const FILTER_LABELS: Record<BoardFilter, string> = {
  all: 'All',
  needs_next: 'Needs next step',
  blocked: 'Blocked only',
  fresh: 'Updated in 10m',
  risky: 'Risky',
};

function filterByFlow(tasks: Task[], filter: BoardFilter) {
  return tasks.filter((task) => {
    if (filter === 'all') return true;
    if (filter === 'fresh') return getHeatBucket(task.updatedAt) === 'fresh';
    if (filter === 'blocked') return isBlockedTask(task);
    if (filter === 'needs_next') return task.status === 'pending' && task.context.length > 0;
    if (filter === 'risky') return getTaskRiskLevel(task) !== 'normal';
    return true;
  });
}

function filterByTaskType(tasks: Task[], taskType: TypeFilter) {
  if (taskType === 'all') return tasks;
  return tasks.filter((task) => (task.taskType || 'general') === taskType);
}

function filterByKeyword(tasks: Task[], keyword: string) {
  const key = keyword.trim().toLowerCase();
  if (!key) return tasks;

  return tasks.filter((task) => {
    const latest = getLatestSummary(task);
    const text = [
      task.taskId,
      task.goal,
      task.description,
      task.publisher,
      task.executor || '',
      task.lastExecutor || '',
      latest,
    ].join('\n').toLowerCase();
    return text.includes(key);
  });
}

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>('board');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeHistoryStatus, setActiveHistoryStatus] = useState<TaskStatus>('completed');
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

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

  const handleApplyKeyword = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(keywordInput.trim());
  }, [keywordInput]);

  const visiblePending = useMemo(() => {
    return filterByKeyword(filterByTaskType(filterByFlow(pendingTasks, boardFilter), typeFilter), keyword);
  }, [pendingTasks, boardFilter, typeFilter, keyword]);

  const visibleRunning = useMemo(() => {
    return filterByKeyword(filterByTaskType(filterByFlow(runningTasks, boardFilter), typeFilter), keyword);
  }, [runningTasks, boardFilter, typeFilter, keyword]);

  const board = useMemo(() => {
    const newTasks = visiblePending.filter((task) => task.context.length === 0);
    const queuedNext = visiblePending.filter((task) => task.context.length > 0 && !isBlockedTask(task));
    const blockedNext = visiblePending.filter((task) => task.context.length > 0 && isBlockedTask(task));
    const activeWork = visibleRunning;
    const risky = [...visiblePending, ...visibleRunning].filter((task) => getTaskRiskLevel(task) !== 'normal');

    return { newTasks, queuedNext, blockedNext, activeWork, risky };
  }, [visiblePending, visibleRunning]);

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
        taskType: task.taskType || 'general',
        summary: getLatestSummary(task),
        heat: getHeatBucket(task.updatedAt),
        risk: getTaskRiskLevel(task),
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
            Follow each task through next / complete / fail decisions with clearer task quality and runtime traces.
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

        <div className="toolbar-group">
          <span className="toolbar-label">Task type</span>
          <select className="log-select toolbar-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
            <option value="all">All types</option>
            {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((type) => (
              <option key={type} value={type}>{TASK_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>

        <form className="toolbar-group toolbar-search" onSubmit={handleApplyKeyword}>
          <span className="toolbar-label">Search</span>
          <input
            className="log-input toolbar-input"
            placeholder="taskId / description / summary"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
          <button type="submit" className="tab">Apply</button>
          <button type="button" className="tab" onClick={() => { setKeywordInput(''); setKeyword(''); }}>Clear</button>
        </form>
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
              <div className="spotlight-top-row">
                <span className={`status-chip status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                <span className={`risk-chip risk-chip-${item.risk}`}>{item.risk}</span>
              </div>
              <strong>{item.taskId.slice(-8)} · {TASK_TYPE_LABELS[item.taskType]}</strong>
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
