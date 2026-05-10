import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface TempWorkspace {
  root: string;
  queueDir: string;
  tasksDir: string;
  cleanup: () => Promise<void>;
}

export async function createTempWorkspace(prefix = 'mteam-test-'): Promise<TempWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const queueDir = path.join(root, 'queue');
  const tasksDir = path.join(root, 'tasks');

  await fs.mkdir(queueDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });

  return {
    root,
    queueDir,
    tasksDir,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
