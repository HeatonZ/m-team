import { useEffect, useMemo, useState } from 'react';
import { editTask as editTaskRequest } from '../api/client';
import type { Task, TaskPriority, TaskStatus, TaskType } from '../types/task';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_TYPE_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '../types/task';

interface TaskEditModalProps {
  task: Task | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

function toNullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function TaskEditModal({ task, onClose, onSaved }: TaskEditModalProps) {
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [taskType, setTaskType] = useState<TaskType>('general');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [publisher, setPublisher] = useState('');
  const [executor, setExecutor] = useState('');
  const [lastExecutor, setLastExecutor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setGoal(task.goal);
    setDescription(task.description);
    setStatus(task.status);
    setTaskType(task.taskType ?? 'general');
    setPriority(task.priority);
    setPublisher(task.publisher);
    setExecutor(task.executor ?? '');
    setLastExecutor(task.lastExecutor ?? '');
    setError(null);
    setSaving(false);
  }, [task]);

  const hasChanges = useMemo(() => {
    if (!task) return false;
    const normalizedTaskType = task.taskType ?? 'general';
    return (
      goal !== task.goal
      || description !== task.description
      || status !== task.status
      || taskType !== normalizedTaskType
      || priority !== task.priority
      || publisher !== task.publisher
      || toNullableText(executor) !== (task.executor ?? null)
      || toNullableText(lastExecutor) !== (task.lastExecutor ?? null)
    );
  }, [task, goal, description, status, taskType, priority, publisher, executor, lastExecutor]);

  async function handleSave() {
    if (!task || saving || !hasChanges) return;
    setSaving(true);
    setError(null);

    const normalizedTaskType = task.taskType ?? 'general';
    const nextExecutor = toNullableText(executor);
    const nextLastExecutor = toNullableText(lastExecutor);

    const patch: {
      goal?: string;
      description?: string;
      status?: TaskStatus;
      taskType?: TaskType;
      priority?: TaskPriority;
      publisher?: string;
      executor?: string | null;
      lastExecutor?: string | null;
    } = {};

    if (goal !== task.goal) patch.goal = goal;
    if (description !== task.description) patch.description = description;
    if (status !== task.status) patch.status = status;
    if (taskType !== normalizedTaskType) patch.taskType = taskType;
    if (priority !== task.priority) patch.priority = priority;
    if (publisher !== task.publisher) patch.publisher = publisher;
    if (nextExecutor !== (task.executor ?? null)) patch.executor = nextExecutor;
    if (nextLastExecutor !== (task.lastExecutor ?? null)) patch.lastExecutor = nextLastExecutor;

    try {
      const updated = await editTaskRequest(task.taskId, patch);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!task) return null;

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg task-edit-modal">
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-hero">
          <div>
            <div className="hero-eyebrow">Edit task</div>
            <h3>{task.taskId}</h3>
            <div className="modal-goal">Update core task fields: goal, current step, routing, and status.</div>
          </div>
          <div className="modal-badges">
            <span className={`status-chip status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
            <span className="status-chip neutral-chip">{TASK_TYPE_LABELS[task.taskType ?? 'general']}</span>
          </div>
        </div>

        <div className="task-edit-grid">
          <label className="task-edit-field task-edit-field-wide">
            <span className="field-label">Goal</span>
            <textarea
              className="log-input task-edit-textarea"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
            />
          </label>

          <label className="task-edit-field task-edit-field-wide">
            <span className="field-label">Description (current step)</span>
            <textarea
              className="log-input task-edit-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>

          <label className="task-edit-field">
            <span className="field-label">Status</span>
            <select className="log-select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((item) => (
                <option key={item} value={item}>{STATUS_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="task-edit-field">
            <span className="field-label">Task type</span>
            <select className="log-select" value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)}>
              {TASK_TYPES.map((item) => (
                <option key={item} value={item}>{TASK_TYPE_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="task-edit-field">
            <span className="field-label">Priority</span>
            <select className="log-select" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((item) => (
                <option key={item} value={item}>{PRIORITY_LABELS[item]}</option>
              ))}
            </select>
          </label>

          <label className="task-edit-field">
            <span className="field-label">Publisher</span>
            <input className="log-input" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </label>

          <label className="task-edit-field">
            <span className="field-label">Executor (blank = null)</span>
            <input className="log-input" value={executor} onChange={(e) => setExecutor(e.target.value)} />
          </label>

          <label className="task-edit-field">
            <span className="field-label">Last executor (blank = null)</span>
            <input className="log-input" value={lastExecutor} onChange={(e) => setLastExecutor(e.target.value)} />
          </label>
        </div>

        {error ? <div className="task-edit-error">{error}</div> : null}

        <div className="task-edit-actions">
          <button className="tab" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="tab active" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
