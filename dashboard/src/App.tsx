import { useMemo, useState, useCallback } from 'react';
import type { Task, TaskPhase, TaskStatus } from './types/task';
import { PHASE_LABELS } from './types/task';
import { Header } from './components/Header';
import { TaskColumn } from './components/TaskColumn';
import { HistoryTab } from './components/HistoryTab';
import { LogsTab } from './components/LogsTab';
import { TaskDetailModal } from './components/TaskDetailModal';
import { usePendingTasks, useRunningTasks, useHistoryTasks } from './hooks/useTasks';
import { fetchTaskDetail } from './api/client';

type MainTab = 'board' | 'logs';
type RiskFilter = 'all' | 'risk_only';
type HeatFilter = 'all' | 'fresh' | 'aging' | 'stale';

function getLoopRiskLevel(task: Task): 'normal' | 'warning' | 'danger' {
  const guard = task.lifecycle?.loopGuard;
  if (!guard) return 'normal';
  if (guard.noProgressCount >= 2 || guard.sameDescriptionCount >= 3 || guard.samePhaseCount >= 4) return 'danger';
  if (guard.noProgressCount >= 1 || guard.sameDescriptionCount >= 2 || guard.samePhaseCount >= 3) return 'warning';
  return 'normal';
}

function getLatestSummary(task: Task): string {
  const latest = [...task.context].reverse().find((entry) => entry.output?.summary || entry.output?.handoffNote || entry.output?.completionNote);
  return latest?.output?.handoffNote || latest?.output?.summary || latest?.output?.completionNote || '暂无最新摘要';
}

function getHeatBucket(updatedAt: number): HeatFilter {
  const ageMinutes = Math.max(0, (Date.now() - updatedAt) / 60_000);
  if (ageMinutes < 10) return 'fresh';
  if (ageMinutes < 30) return 'aging';
  return 'stale';
}

function filterTasks(tasks: Task[], riskFilter: RiskFilter, heatFilter: HeatFilter) {
  return tasks.filter((task) => {
    const riskOk = riskFilter === 'all' || getLoopRiskLevel(task) !== 'normal';
    const heatOk = heatFilter === 'all' || getHeatBucket(task.updatedAt) === heatFilter;
    return riskOk && heatOk;
  });
}

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeHistoryStatus, setActiveHistoryStatus] = useState<TaskStatus>('completed');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [heatFilter, setHeatFilter] = useState<HeatFilter>('all');

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

  const boardGroups = useMemo(() => {
    const pendingByPhase: Record<TaskPhase, Task[]> = {
      ready: [], handoff: [], reworking: [], executing: [], finalizing: [], done: [],
    };

    for (const task of filterTasks(pendingTasks, riskFilter, heatFilter)) {
      pendingByPhase[task.lifecycle?.phase ?? 'ready']?.push(task);
    }

    const filteredRunning = filterTasks(runningTasks, riskFilter, heatFilter);
    const runningExecuting = filteredRunning.filter((task) => task.lifecycle?.phase === 'executing');
    const runningFinalizing = filteredRunning.filter((task) => task.lifecycle?.phase === 'finalizing');
    const riskyTasks = [...pendingTasks, ...runningTasks].filter((task) => getLoopRiskLevel(task) !== 'normal');

    return {
      ready: pendingByPhase.ready,
      handoff: pendingByPhase.handoff,
      reworking: pendingByPhase.reworking,
      executing: runningExecuting,
      finalizing: runningFinalizing,
      risk: riskyTasks,
    };
  }, [pendingTasks, runningTasks, riskFilter, heatFilter]);

  const stats = useMemo(() => {
    const allActive = [...pendingTasks, ...runningTasks];
    return {
      active: allActive.length,
      handoff: boardGroups.handoff.length,
      reworking: boardGroups.reworking.length,
      finalizing: boardGroups.finalizing.length,
      risk: boardGroups.risk.length,
    };
  }, [pendingTasks, runningTasks, boardGroups]);

  const heatline = useMemo(() => {
    const active = [...pendingTasks, ...runningTasks]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((task) => ({
        taskId: task.taskId,
        phase: task.lifecycle.phase,
        bucket: getHeatBucket(task.updatedAt),
        summary: getLatestSummary(task),
        updatedAt: task.updatedAt,
      }));
    return active;
  }, [pendingTasks, runningTasks]);

  return (
    <div className="container">
      <Header onRefresh={handleRefresh} />

      <div className="hero-panel">
        <div>
          <div className="hero-eyebrow">M-Team Chain View</div>
          <h2 className="hero-title">链式任务看板</h2>
          <p className="hero-subtitle">按阶段看任务接力：新任务、交接、返工、执行、收口、风险，一眼看清。</p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card"><span>活跃任务</span><strong>{stats.active}</strong></div>
          <div className="hero-stat-card"><span>等待交接</span><strong>{stats.handoff}</strong></div>
          <div className="hero-stat-card"><span>返工中</span><strong>{stats.reworking}</strong></div>
          <div className="hero-stat-card"><span>收口中</span><strong>{stats.finalizing}</strong></div>
          <div className="hero-stat-card hero-stat-card-risk"><span>风险任务</span><strong>{stats.risk}</strong></div>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-group">
          <span className="toolbar-label">风险筛选</span>
          <button className={`filter-chip${riskFilter === 'all' ? ' active' : ''}`} onClick={() => setRiskFilter('all')}>全部</button>
          <button className={`filter-chip${riskFilter === 'risk_only' ? ' active' : ''}`} onClick={() => setRiskFilter('risk_only')}>只看风险</button>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">热度筛选</span>
          <button className={`filter-chip${heatFilter === 'all' ? ' active' : ''}`} onClick={() => setHeatFilter('all')}>全部</button>
          <button className={`filter-chip${heatFilter === 'fresh' ? ' active' : ''}`} onClick={() => setHeatFilter('fresh')}>10分钟内</button>
          <button className={`filter-chip${heatFilter === 'aging' ? ' active' : ''}`} onClick={() => setHeatFilter('aging')}>10-30分钟</button>
          <button className={`filter-chip${heatFilter === 'stale' ? ' active' : ''}`} onClick={() => setHeatFilter('stale')}>30分钟以上</button>
        </div>
      </div>

      <div className="heatline-panel">
        <div className="section-header">
          <div>
            <h2>🌡️ 任务热度带</h2>
            <div className="section-subtitle">按最近更新时间排序。蓝 = 新鲜，黄 = 变老，红 = 久未更新。</div>
          </div>
        </div>
        <div className="heatline-track">
          {heatline.map((item) => (
            <button key={item.taskId} className={`heatline-node heat-${item.bucket}`} onClick={() => handleCardClick(item.taskId)} title={`${item.taskId} · ${item.summary}`}>
              <span className="heatline-phase">{PHASE_LABELS[item.phase]}</span>
              <strong>{item.taskId.slice(-6)}</strong>
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
            <TaskColumn title="🆕 新任务" subtitle={`phase = ${PHASE_LABELS.ready}`} tasks={boardGroups.ready} onCardClick={handleCardClick} variant="ready" />
            <TaskColumn title="🤝 等待下一棒" subtitle={`phase = ${PHASE_LABELS.handoff}`} tasks={boardGroups.handoff} onCardClick={handleCardClick} variant="handoff" />
            <TaskColumn title="🛠️ 返工修正" subtitle={`phase = ${PHASE_LABELS.reworking}`} tasks={boardGroups.reworking} onCardClick={handleCardClick} variant="reworking" />
          </div>

          <div className="board-grid board-grid-bottom">
            <TaskColumn title="⚙️ 执行中" subtitle={`phase = ${PHASE_LABELS.executing}`} tasks={boardGroups.executing} onCardClick={handleCardClick} variant="executing" />
            <TaskColumn title="✨ 收口中" subtitle={`phase = ${PHASE_LABELS.finalizing}`} tasks={boardGroups.finalizing} onCardClick={handleCardClick} variant="finalizing" />
            <TaskColumn title="🚨 风险雷达" subtitle="疑似循环 / 无进展 / 重复 description" tasks={boardGroups.risk} onCardClick={handleCardClick} variant="risk" emptyText="当前没有风险任务" cardDecorator={(task) => `${getLatestSummary(task)}`} />
          </div>

          <HistoryTab activeStatus={activeHistoryStatus} tasks={historyTasks} onStatusChange={setActiveHistoryStatus} onCardClick={handleCardClick} page={historyPage} totalPages={historyTotalPages} total={historyTotal} onPageChange={setHistoryPage} />
        </>
      )}

      {mainTab === 'logs' && <LogsTab />}

      <TaskDetailModal task={selectedTask} onClose={handleCloseModal} onUpdate={(updated) => { handleRefresh(); setSelectedTask(updated); }} />
    </div>
  );
}
