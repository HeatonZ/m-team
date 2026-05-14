import type { FC } from 'react';
import type { Task, ContextStepEntry } from '../types/task';
import { STATUS_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from '../types/task';
import { formatRelativeTime, formatTime, escHtml } from '../utils/format';
import { getLatestIssues, getLatestStep, getTaskRiskLevel } from '../utils/task';

interface TaskDetailModalProps {
  task: Task | null;
  onClose: () => void;
  onEdit: (task: Task) => void;
}

function getFlowSummary(task: Task) {
  if (task.status === 'running') return 'Currently held by an executor and working on this step.';
  if (task.status === 'pending' && task.context.length === 0) return 'Fresh task waiting for the first claim.';
  if (task.status === 'pending') return 'Previous step ended and next step is queued for reclaim.';
  if (task.status === 'completed') return 'Executor work is done and waiting for publisher acceptance.';
  if (task.status === 'closed') return 'Task has passed acceptance and is closed.';
  if (task.status === 'failed') return 'Task failed and likely needs human judgment or republish.';
  return 'Task has been cancelled.';
}

function renderJson(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const TaskDetailModal: FC<TaskDetailModalProps> = ({ task, onClose, onEdit }) => {
  if (!task) return null;

  const steps = task.context as ContextStepEntry[];
  const latest = getLatestStep(task);
  const latestIssues = getLatestIssues(task);
  const risk = getTaskRiskLevel(task);
  const acceptance = task.acceptance;

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <button className="modal-close" onClick={onClose}>×</button>
        <button className="tab task-detail-edit-btn" onClick={() => onEdit(task)}>Edit task</button>

        <div className="modal-hero">
          <div>
            <div className="hero-eyebrow">{TASK_TYPE_LABELS[task.taskType || 'general']} · {task.taskId}</div>
            <h3>{escHtml(task.description)}</h3>
            <div className="modal-goal">Goal: {escHtml(task.goal)}</div>
            <div className="modal-goal modal-flow">{getFlowSummary(task)}</div>
          </div>
          <div className="modal-badges">
            <span className={`status-chip status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
            <span className="status-chip neutral-chip">{PRIORITY_LABELS[task.priority]}</span>
            <span className="status-chip neutral-chip">{formatRelativeTime(task.updatedAt)}</span>
            <span className={`risk-chip risk-chip-${risk}`}>{risk.toUpperCase()}</span>
          </div>
        </div>

        <div className="detail-grid detail-grid-top">
          <div className="detail-panel">
            <h4>Task state</h4>
            <Field label="Publisher"><span className="field-value">{escHtml(task.publisher)}</span></Field>
            <Field label="Current executor"><span className="field-value">{task.executor || '-'}</span></Field>
            <Field label="Last executor"><span className="field-value">{task.lastExecutor || '-'}</span></Field>
            <Field label="Created at"><span className="field-value">{formatTime(task.createdAt)}</span></Field>
            <Field label="Updated at"><span className="field-value">{formatTime(task.updatedAt)}</span></Field>
            <Field label="Completed at"><span className="field-value">{formatTime(task.completedAt)}</span></Field>
          </div>

          <div className="detail-panel detail-panel-accent">
            <h4>Current focus</h4>
            <Field label="Latest step"><span className="field-value">{latest?.step || '-'}</span></Field>
            <Field label="Latest summary"><span className="field-value">{latest?.output?.summary || '-'}</span></Field>
            <Field label="Latest outputs"><span className="field-value">{latest?.output?.files?.join(', ') || '-'}</span></Field>
            <Field label="Next-step state"><span className="field-value">{task.status === 'pending' && task.context.length > 0 ? 'Queued and waiting for claim' : '-'}</span></Field>
          </div>

          <div className="detail-panel detail-panel-warning">
            <h4>Open issues</h4>
            {latestIssues.length === 0 ? (
              <div className="empty compact-empty">No unresolved issues right now</div>
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
            <h4>Latest evidence</h4>
            <div className="field-value modal-block">
              {latest?.output?.summary || latest?.step || 'No summary yet'}
            </div>
            {latest?.output?.files?.length ? (
              <div className="pill-row">
                {latest.output.files.map((file, idx) => (
                  <span className="data-pill" key={`${file}-${idx}`}>{file}</span>
                ))}
              </div>
            ) : null}
            {latest?.output ? (
              <details className="log-details">
                <summary>Raw latest output</summary>
                <pre className="modal-pre">{renderJson(latest.output)}</pre>
              </details>
            ) : null}
          </div>

          <div className="detail-panel detail-panel-wide detail-panel-acceptance">
            <h4>Acceptance snapshot</h4>
            {acceptance ? (
              <>
                <Field label="Summary"><span className="field-value">{acceptance.summary || '-'}</span></Field>
                <Field label="Task directory"><span className="field-value">{acceptance.taskDir || '-'}</span></Field>
                <Field label="Files">
                  <span className="field-value">{acceptance.files?.length ? acceptance.files.join(', ') : '-'}</span>
                </Field>
                <Field label="Updated at"><span className="field-value">{formatTime(acceptance.updatedAt)}</span></Field>
                <Field label="Source"><span className="field-value">{acceptance.source || '-'}</span></Field>
              </>
            ) : (
              <div className="empty compact-empty">No acceptance snapshot yet</div>
            )}
          </div>

          <div className="detail-panel detail-panel-wide">
            <h4>Context timeline</h4>
            {steps.length === 0 ? (
              <div className="empty">No step history yet</div>
            ) : (
              <div className="timeline-list">
                {steps.map((step, index) => (
                  <div key={index} className="context-step timeline-step">
                    <div className="context-step-header">
                      <span className="context-step-executor">{escHtml(step.executor || '-')}</span>
                      <span className="context-step-time">{formatTime(step.completedAt)}</span>
                    </div>
                    <div className="context-step-title">{escHtml(step.step)}</div>
                    {step.output?.summary && <div className="context-step-summary">{escHtml(step.output.summary)}</div>}
                    {step.output?.files?.length ? <div className="context-step-files">Files: {step.output.files.join(', ')}</div> : null}
                    {step.output?.unresolvedIssues?.length ? <div className="context-step-files">Issues: {step.output.unresolvedIssues.join(' ; ')}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
