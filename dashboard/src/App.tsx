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

type MainTab = 'board' | 'logs';
type BoardFilter = 'all' | 'needs_next' | 'blocked' | 'fresh';

function getLatestStep(task: Task) {
  return [...task.context].reverse().find((entry) => entry.type === 'step');
}

function getLatestSummary(task: Task): string {
  const latest = getLatestStep(task);
  return latest?.output?.summary || latest?.step || '暂无最新摘要';
}

function getLatestIssues(task: Task): string[] {
  const latest = getLatestStep(task);
  return latest?.output?.unresolvedIssues ?? [];
}

function getHeatBucket(updatedAt: number): 'fresh' | 'aging' | 'stale' {
  const ageMinutes = Math.max(0, (Date.now() - updatedAt) / 60_000);
  if (ageMinutes < 10) return 'fresh';
  if (ageMinutes < 30) return 'aging';
  return 'stale';
}

function isBlocked(task: Task): boolean {
  return getLatestIssues(task).some((issue) => /阻塞|权限|前置|外部|失败|无法继续/i.test(issue));
}

function filterTasks(tasks: Task[], filter: BoardFilter) {
  return tasks.filter((task) => {
    if (filter === 'all') return true;
    if (filter === 'fresh') return getHeatBucket(task.updatedAt) === 'fresh';
    if (filter === 'blocked') return isBlocked(task);
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
    } catch (err) {
      console.error('Failed to load task detail:', err);
    }
  }, []);

  const board = useMemo(() => {
    const filteredPending = filterTasks(pendingTasks, boardFilter);
    const filteredRunning = filterTasks(runningTasks, boardFilter);

    const newTasks = filteredPending.filter((task) => task.context.length === 0);
    const queuedNext = filteredPending.filter((task) => task.context.length > 0 && !isBlocked(task));
    const blockedNext = filteredPending.filter((task) => task.context.length > 0 && isBlocked(task));
    const activeWork = filteredRunning;
    const risky = [...filteredPending, ...filteredRunning].filter((task) => isBlocked(task) || getHeatBucket(task.updatedAt) === 'stale');

    return { newTasks, queuedNext, blockedNext, activeWork, risky };
  }, [pendingTasks, runningTasks, boardFilter]);

  const stats = useMemo(() => ({
    totalActive: pendingTasks.length + runningTasks.length,
    waitingNext: pendingTasks.filter((task) => task.context.length > 0).length,
    blocked: [...pendingTasks, ...runningTasks].filter(isBlocked).length,
    running: runningTasks.length,
    fresh: [...pendingTasks, ...runningTasks].filter((task) => getHeatBucket(task.updatedAt) === 'fresh').length,
  }), [pendingTasks, runningTasks]);

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
          <h2 className="hero-title">任务闭环看板</h2>
          <p className="hero-subtitle">
            以 next / complete / fail 为主线，清晰查看当前执行、等待下一步、阻塞问题和验收历史。
          </p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card"><span>活跃任务</span><strong>{stats.totalActive}</strong></div>
          <div className="hero-stat-card"><span>等待下一步</span><strong>{stats.waitingNext}</strong></div>
          <div className="hero-stat-card"><span>执行中</span><strong>{stats.running}</strong></div>
          <div className="hero-stat-card hero-stat-card-warn"><span>阻塞问题</span><strong>{stats.blocked}</strong></div>
          <div className="hero-stat-card"><span>10分钟内更新</span><strong>{stats.fresh}</strong></div>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-group">
          <span className="toolbar-label">看板筛选</span>
          <button className={`filter-chip${boardFilter === 'all' ? ' active' : ''}`} onClick={() => setBoardFilter('all')}>全部</button>
          <button className={`filter-chip${boardFilter === 'needs_next' ? ' active' : ''}`} onClick={() => setBoardFilter('needs_next')}>只看下一步</button>
          <button className={`filter-chip${boardFilter === 'blocked' ? ' active' : ''}`} onClick={() => setBoardFilter('blocked')}>只看阻塞</button>
          <button className={`filter-chip${boardFilter === 'fresh' ? ' active' : ''}`} onClick={() => setBoardFilter('fresh')}>只看最近更新</button>
        </div>
      </div>

      <div className="spotlight-panel">
        <div className="section-header">
          <div>
            <h2>🛰️ 最近动态</h2>
            <div className="section-subtitle">用于快速定位正在变化的任务和最新问题摘要。</div>
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
        <button className={`tab${mainTab === 'board' ? ' active' : ''}`} onClick={() => setMainTab('board')}>看板</button>
        <button className={`tab${mainTab === 'logs' ? ' active' : ''}`} onClick={() => setMainTab('logs')}>日志</button>
      </div>

      {mainTab === 'board' && (
        <>
          <div className="board-grid board-grid-top">
            <TaskColumn title="🆕 新任务" subtitle="首次发布，尚未形成历史步骤" tasks={board.newTasks} onCardClick={handleCardClick} variant="new" />
            <TaskColumn title="🔄 等待下一步" subtitle="agent_end 已生成 nextDescription，等待下一棒认领" tasks={board.queuedNext} onCardClick={handleCardClick} variant="next" />
            <TaskColumn title="🚧 阻塞待处理" subtitle="上一棒已报告问题，下一步需要先处理阻塞项" tasks={board.blockedNext} onCardClick={handleCardClick} variant="blocked" />
          </div>

          <div className="board-grid board-grid-bottom">
            <TaskColumn title="⚙️ 当前执行中" subtitle="已有 executor 持有，正在完成当前一棒" tasks={board.activeWork} onCardClick={handleCardClick} variant="running" />
            <TaskColumn
              title="🧭 风险与关注"
              subtitle="长时间未更新、带阻塞问题或需重点关注的任务"
              tasks={board.risky}
              onCardClick={handleCardClick}
              variant="risk"
              emptyText="当前没有需要特别关注的任务"
              cardDecorator={(task) => getLatestSummary(task)}
            />
          </div>

          <HistoryTab activeStatus={activeHistoryStatus} tasks={historyTasks} onStatusChange={setActiveHistoryStatus} onCardClick={handleCardClick} page={historyPage} totalPages={historyTotalPages} total={historyTotal} onPageChange={setHistoryPage} />
        </>
      )}

      {mainTab === 'logs' && <LogsTab />}

      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={(updated) => { handleRefresh(); setSelectedTask(updated); }} />
    </div>
  );
}
