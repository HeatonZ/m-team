import { useState } from 'react';
import type { FC } from 'react';
import type { Task, ContextStepEntry } from '../types/task';
import { STATUS_LABELS, PRIORITY_LABELS, PHASE_LABELS } from '../types/task';
import { formatTime, escHtml } from '../utils/format';
import { TaskEditModal } from './TaskEditModal';

interface TaskDetailModalProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (updated: Task) => void;
}

export const TaskDetailModal: FC<TaskDetailModalProps> = ({ task, onClose, onUpdate }) => {
  const [showEdit, setShowEdit] = useState(false);
  if (!task) return null;

  const steps = task.context as ContextStepEntry[];
  const latest = steps[steps.length - 1];
  const loopGuard = task.lifecycle.loopGuard;

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-hero">
          <div>
            <div className="hero-eyebrow">{task.taskType || 'general'} · {task.taskId}</div>
            <h3>{escHtml(task.description)}</h3>
            <div className="modal-goal">目标：{escHtml(task.goal)}</div>
          </div>
          <div className="modal-badges">
            <span className={`phase-badge phase-${task.lifecycle.phase}`}>{PHASE_LABELS[task.lifecycle.phase]}</span>
            <span className={`status-chip status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
            <span className="status-chip neutral-chip">{PRIORITY_LABELS[task.priority]}</span>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-panel">
            <h4>当前状态</h4>
            <Field label="发布者"><span className="field-value">{escHtml(task.publisher)}</span></Field>
            <Field label="当前执行者"><span className="field-value">{task.executor || '—'}</span></Field>
            <Field label="上一步执行者"><span className="field-value">{task.lastExecutor || '—'}</span></Field>
            <Field label="创建时间"><span className="field-value">{formatTime(task.createdAt)}</span></Field>
            <Field label="完成时间"><span className="field-value">{formatTime(task.completedAt)}</span></Field>
            <Field label="更新时间"><span className="field-value">{formatTime(task.updatedAt)}</span></Field>
          </div>

          <div className="detail-panel detail-panel-accent">
            <h4>链式指标</h4>
            <div className="metrics-grid">
              <Metric label="交接次数" value={task.lifecycle.handoffCount} />
              <Metric label="返工次数" value={task.lifecycle.reworkCount} />
              <Metric label="最近决策" value={task.lifecycle.lastDecision || '—'} />
              <Metric label="最近决策时间" value={task.lifecycle.lastDecisionAt ? formatTime(task.lifecycle.lastDecisionAt) : '—'} />
            </div>
          </div>

          <div className="detail-panel detail-panel-warning">
            <h4>Loop Guard</h4>
            <div className="metrics-grid">
              <Metric label="同 phase 次数" value={loopGuard.samePhaseCount} />
              <Metric label="同描述次数" value={loopGuard.sameDescriptionCount} />
              <Metric label="无进展次数" value={loopGuard.noProgressCount} />
              <Metric label="最近进展" value={loopGuard.lastProgressAt ? formatTime(loopGuard.lastProgressAt) : '—'} />
            </div>
          </div>
        </div>

        <div className="detail-grid detail-grid-bottom">
          <div className="detail-panel detail-panel-wide">
            <h4>最新交接摘要</h4>
            <div className="field-value modal-block">
              {latest?.output?.handoffNote || latest?.output?.summary || latest?.output?.completionNote || '暂无摘要'}
            </div>
            {latest?.output?.unresolvedIssues?.length ? (
              <div className="pill-row">
                {latest.output.unresolvedIssues.map((issue, idx) => (
                  <span className="issue-pill" key={`${issue}-${idx}`}>{issue}</span>
                ))}
              </div>
            ) : null}
            {latest?.output?.dataRefs?.length ? (
              <div className="pill-row">
                {latest.output.dataRefs.map((ref, idx) => (
                  <span className="data-pill" key={`${ref}-${idx}`}>{ref}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="detail-panel detail-panel-wide">
            <h4>Context 时间线</h4>
            {steps.length === 0 ? (
              <div className="empty">暂无步骤历史</div>
            ) : (
              <div className="timeline-list">
                {steps.map((s, i) => (
                  <div key={i} className="context-step timeline-step">
                    <div className="context-step-header">
                      <span className="context-step-executor">{escHtml(s.executor || '—')}</span>
                      <span className="context-step-time">{formatTime(s.completedAt)}</span>
                    </div>
                    <div className="context-step-title">{escHtml(s.step)}</div>
                    {s.output?.summary && <div className="context-step-summary">{escHtml(s.output.summary)}</div>}
                    {s.output?.handoffNote && <div className="context-step-note">下一棒：{escHtml(s.output.handoffNote)}</div>}
                    {s.output?.files?.length ? <div className="context-step-files">文件：{s.output.files.join(', ')}</div> : null}
                    {s.output?.metrics ? (
                      <div className="context-step-files">指标：{Object.entries(s.output.metrics).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn-edit" onClick={() => setShowEdit(true)}>✏️ 编辑</button>
      </div>

      {showEdit && (
        <TaskEditModal
          task={task}
          onClose={() => setShowEdit(false)}
          onSave={onUpdate}
        />
      )}
    </div>
  );
};

const Field: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="field">
    <div className="field-label">{label}</div>
    {children}
  </div>
);

const Metric: FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
  </div>
);
