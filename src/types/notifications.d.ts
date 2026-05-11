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
  export function formatNextNotifications(task: unknown, notifications: Notification[]): Notification[];
  export function formatPublishNotifications(task: unknown, notifications: Notification[]): Notification[];
  export function formatClaimNotifications(task: unknown, notifications: Notification[]): Notification[];
  export function formatCancelNotifications(task: unknown, notifications: Notification[]): Notification[];
  export async function sendNotifications(notifications: Notification[], logger?: unknown): Promise<void>;
}

declare module '../hooks/subagentEnded.js' {
  export function registerSubagentEndedHook(hook: (info: {
    taskId: string;
    agentId: string;
    outcome: string;
    error?: string;
  }) => void): void;
}
