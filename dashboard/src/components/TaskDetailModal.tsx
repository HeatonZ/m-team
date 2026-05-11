import { useState } from 'react';
import type { FC } from 'react';
import type { Task, ContextStepEntry } from '../types/task';
import { STATUS_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from '../types/task';
import { formatRelativeTime, formatTime, escHtml } from '../utils/format';
import { TaskEditModal } from './TaskEditModal';

interface TaskDetailModalProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (updated: Task) => void;
}

function getLatestStep(task: Task) {
  return [...task.context].reverse().find((entry) => entry.type === 'step');
}

function getLatestIssues(task: Task): string[] {
  return getLatestStep(task)?.output?.unresolvedIssues ?? [];
}

function getFlowSummary(task: Task) {
  if (task.status === 'running') return '当前由执行者持有，正在完成这一棒。';
  if (task.status === 'pending' && task.context.length === 0) return '新任务，等待第一位执行者认领。';
  if (task.status === 'pending') return '上一棒已结束，agent_end 已生成下一步，等待重新认领。';
  if (task.status === 'completed') return '整体结果已提交，等待 Publisher 验收。';
  if (task.status === 'closed') return '任务已完成并通过验收。';
  if (task.status === 'failed') return '当前任务已失败，需人工判断是否重新发布或补前置。';
  return '任务已取消。';
}

export const TaskDetailModal: FC<TaskDetailModalProps> = ({ task, onClose, onUpdate }) => {
  const [showEdit, setShowEdit] = useState(false);
  if (!task) return null;

  const steps = task.context as ContextStepEntry[];
  const latest = getLatestStep(task);
  const latestIssues = getLatestIssues(task);

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-hero">
          <div>
            <div className="hero-eyebrow">{TASK_TYPE_LABELS[task.taskType || 'general']} · {task.taskId}</div>
            <h3>{escHtml(task.description)}</h3>
            <div className="modal-goal">目标：{escHtml(task.goal)}</div>
            <div className="modal-goal modal-flow">{getFlowSummary(task)}</div>
          </div>
          <div className="modal-badges">
            <span className={`status-chip status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
            <span className="status-chip neutral-chip">{PRIORITY_LABELS[task.priority]}</span>
            <span className="status-chip neutral-chip">{formatRelativeTime(task.updatedAt)}</span>
          </div>
        </div>

        <div className="detail-grid detail-grid-top">
          <div className="detail-panel">
            <h4>任务状态</h4>
            <Field label="发布者"><span className="field-value">{escHtml(task.publisher)}</span></Field>
            <Field label="当前执行者"><span className="field-value">{task.executor || '—'}</span></Field>
            <Field label="上一棒执行者"><span className="field-value">{task.lastExecutor || '—'}</span></Field>
            <Field label="创建时间"><span className="field-value">{formatTime(task.createdAt)}</span></Field>
            <Field label="更新时间"><span className="field-value">{formatTime(task.updatedAt)}</span></Field>
            <Field label="完成时间"><span className="field-value">{formatTime(task.completedAt)}</span></Field>
          </div>

          <div className="detail-panel detail-panel-accent">
            <h4>本轮关注点</h4>
            <Field label="最新步骤"><span className="field-value">{latest?.step || '—'}</span></Field>
            <Field label="最新摘要"><span className="field-value">{latest?.output?.summary || '—'}</span></Field>
            <Field label="最新产物"><span className="field-value">{latest?.output?.files?.join(', ') || '—'}</span></Field>
            <Field label="下一步状态"><span className="field-value">{task.status === 'pending' && task.context.length > 0 ? '已生成下一步，等待认领' : '—'}</span></Field>
          </div>

          <div className="detail-panel detail-panel-warning">
            <h4>未解决问题</h4>
            {latestIssues.length === 0 ? (
              <div className="empty compact-empty">当前无未解决问题</div>
            ) : (
              <div className="pill-row">
                {latestIssues.map((issue, idx) => (
                  <span className="issue-pill" key={`${issue}-${idx}`}>{issue}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="detail-grid detail-grid-bottom">
          <div className="detail-panel detail-panel-wide">
            <h4>最新结果与证据</h4>
            <div className="field-value modal-block">
              {latest?.output?.summary || latest?.step || '暂无摘要'}
            </div>
            {latest?.output?.files?.length ? (
              <div className="pill-row">
                {latest.output.files.map((file, idx) => (
                  <span className="data-pill" key={`${file}-${idx}`}>{file}</span>
                ))}
              </div>
            ) : null}
            {latest?.output?.metrics ? (
              <div className="metrics-inline">
                {Object.entries(latest.output.metrics).map(([k, v]) => (
                  <span key={k} className="data-pill">{k}={String(v)}</span>
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
                {steps.map((step, index) => (
                  <div key={index} className="context-step timeline-step">
                    <div className="context-step-header">
                      <span className="context-step-executor">{escHtml(step.executor || '—')}</span>
                      <span className="context-step-time">{formatTime(step.completedAt)}</span>
                    </div>
                    <div className="context-step-title">{escHtml(step.step)}</div>
                    {step.output?.summary && <div className="context-step-summary">{escHtml(step.output.summary)}</div>}
                    {step.output?.files?.length ? <div className="context-step-files">文件：{step.output.files.join(', ')}</div> : null}
                    {step.output?.unresolvedIssues?.length ? (
                      <div className="context-step-files">问题：{step.output.unresolvedIssues.join('；')}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
};

const Field: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="field">
    <div className="field-label">{label}</div>
    {children}
  </div>
);
