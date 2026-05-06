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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const reload = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const result = await fetchHistoryTasks(status, p);
      setTasks(result.tasks);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setPage(result.page);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setPage(1);
    reload(1);
  }, [status]);

  useEffect(() => {
    const id = setInterval(() => reload(page), 15_000);
    return () => clearInterval(id);
  }, [reload, page]);

  return { tasks, loading, reload, page, totalPages, total, setPage };
}
