import { useState } from 'react';
import type { FC } from 'react';
import type { Task, ContextStepEntry } from '../types/task';
import { STATUS_LABELS, PRIORITY_LABELS } from '../types/task';
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

  // context[0] is always the input entry; steps are the rest
  const steps = task.context.slice(1) as ContextStepEntry[];

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>✕</button>
        <h3>{escHtml(task.goal)}</h3>

        <Field label="Task ID">
          <span className="field-value">{task.taskId}</span>
        </Field>

        <Field label="状态">
          <span className={`status-${task.status}`} style={{ fontSize: '14px' }}>
            {STATUS_LABELS[task.status]}
          </span>
        </Field>

        <Field label="优先级">
          <span className="field-value">{PRIORITY_LABELS[task.priority]}</span>
        </Field>

        <Field label="发布者">
          <span className="field-value">{escHtml(task.publisher)}</span>
        </Field>

        <Field label="执行者">
          <span className="field-value">
            {task.executor || '—'}
            {task.lastExecutor ? ` | 上一步: ${escHtml(task.lastExecutor)}` : ''}
          </span>
        </Field>

        <Field label="创建时间">
          <span className="field-value">{formatTime(task.createdAt)}</span>
        </Field>

        <Field label="完成时间">
          <span className="field-value">{formatTime(task.completedAt)}</span>
        </Field>

        <Field label="最后心跳">
          <span className="field-value">{formatTime(task.lastHeartbeatAt)}</span>
        </Field>

        <Field label="描述">
          <div className="field-value" style={{ maxHeight: 150, overflowY: 'auto' }}>
            {escHtml(task.description)}
          </div>
        </Field>

        {steps.length > 0 && (
          <Field label={`执行步骤 (${steps.length})`}>
            {steps.map((s, i) => (
              <div key={i} className="context-step">
                <div className="context-step-header">
                  <span className="context-step-executor">
                    {escHtml(s.executor || '—')}
                  </span>
                  <span className="context-step-time">
                    {formatTime(s.completedAt)}
                  </span>
                </div>
                <div className="context-step-title">{escHtml(s.step)}</div>
                {s.output?.summary && (
                  <div className="context-step-summary">
                    {escHtml(s.output.summary)}
                  </div>
                )}
              </div>
            ))}
          </Field>
        )}
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
