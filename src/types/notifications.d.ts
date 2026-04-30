/**
 * Type declarations for JS modules that haven't been converted to TS yet.
 */

declare module '../notifications' {
  export interface Notification {
    provider: string;
    channelId?: string;
    [key: string]: unknown;
  }

  export function setNotifications(config: Notification[]): void;
  export function getNotifications(): Notification[];
  export function formatTaskNotifications(task: unknown, notifications: Notification[]): Notification[];
  export function formatRelinquishNotifications(task: unknown, notifications: Notification[]): Notification[];
  export async function sendNotifications(notifications: Notification[], api: unknown): Promise<void>;
}

declare module '../hooks/subagentEnded.js' {
  export function registerSubagentEndedHook(hook: (info: {
    sessionKey: string;
    taskId: string;
    agentId: string;
    outcome: string;
    error?: string;
  }) => void): void;
}
