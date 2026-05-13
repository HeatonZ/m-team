import { useState } from 'react';
import type { FC } from 'react';
import type { Task, TaskStatus, TaskPriority } from '../types/task';
import { STATUS_LABELS, PRIORITY_LABELS } from '../types/task';
import { updateTask } from '../api/client';

interface TaskEditModalProps {
  task: Task;
  onClose: () => void;
  onSave: (updated: Task) => void;
}

export const TaskEditModal: FC<TaskEditModalProps> = ({ task, onClose, onSave }) => {
  const [goal, setGoal] = useState(task.goal);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTask(task.taskId, { goal, description, status, priority });
      onSave(updated);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Edit task</h3>

        <div className="field">
          <div className="field-label">Goal (overall final objective)</div>
          <textarea
            className="edit-textarea"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
          />
        </div>

        <div className="field">
          <div className="field-label">Description (current step only)</div>
          <textarea
            className="edit-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        <div className="field">
          <div className="field-label">Status</div>
          <select
            className="edit-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="field-label">Priority</div>
          <select
            className="edit-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
