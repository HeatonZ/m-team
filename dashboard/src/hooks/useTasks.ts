import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskStatus } from '../types/task';
import {
  fetchPendingTasks,
  fetchRunningTasks,
  fetchHistoryTasks,
} from '../api/client';

const POLL_INTERVAL = 15_000;

export function usePendingTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await fetchPendingTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [reload]);

  return { tasks, loading, reload };
}

export function useRunningTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await fetchRunningTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [reload]);

  return { tasks, loading, reload };
}

export function useHistoryTasks(status: TaskStatus) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await fetchHistoryTasks(status));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [reload]);

  return { tasks, loading, reload };
}
