import { describe, expect, test, vi, afterEach } from 'vitest';

const startDashboardMock = vi.fn(() => ({ pid: 4321, killed: false }));
const registerDashboardCleanupMock = vi.fn();
const stopDashboardMock = vi.fn();
const setWorkspaceRootMock = vi.fn();
const setNotificationsMock = vi.fn();
const definePluginEntryMock = vi.fn((input) => input);
const emptyPluginConfigSchemaMock = vi.fn(() => ({}));

vi.mock('../../src/dashboard.js', () => ({
  startDashboard: startDashboardMock,
  registerDashboardCleanup: registerDashboardCleanupMock,
  stopDashboard: stopDashboardMock,
}));

vi.mock('../../src/pool/index.js', () => ({
  setWorkspaceRoot: setWorkspaceRootMock,
}));

vi.mock('../../src/notifications.js', () => ({
  setNotifications: setNotificationsMock,
}));

vi.mock('../../src/tools/index.js', () => ({
  registerTools: vi.fn(),
}));

vi.mock('../../src/hooks/afterToolCall.js', () => ({
  registerAfterToolCallHook: vi.fn(),
}));

vi.mock('../../src/hooks/agentEnd.js', () => ({
  registerAgentEndHook: vi.fn(),
}));

vi.mock('../../src/hooks/heartbeatPromptContribution.js', () => ({
  registerHeartbeatPromptContributionHook: vi.fn(),
}));

vi.mock('../../src/hooks/sessionGuard.js', () => ({
  registerSessionGuardHook: vi.fn(),
}));

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: definePluginEntryMock,
  emptyPluginConfigSchema: emptyPluginConfigSchemaMock,
}));

afterEach(() => {
  startDashboardMock.mockClear();
  registerDashboardCleanupMock.mockClear();
  stopDashboardMock.mockClear();
  setWorkspaceRootMock.mockClear();
  setNotificationsMock.mockClear();
  definePluginEntryMock.mockClear();
  emptyPluginConfigSchemaMock.mockClear();
  delete process.env.PORT;
  vi.resetModules();
});

describe('plugin dashboard bootstrap boundary', () => {
  test('does not start dashboard in tests when dashboardEnabled is false', async () => {
    const pluginModule = await import('../../src/index.ts');
    const api = {
      pluginConfig: { workspaceRoot: '/tmp/mteam-test', dashboardEnabled: false },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
      registerTool: vi.fn(),
    } as never;

    pluginModule.default.register(api);

    expect(startDashboardMock).not.toHaveBeenCalled();
    expect(registerDashboardCleanupMock).not.toHaveBeenCalled();
  });

  test('starts dashboard with explicit config port before env fallback', async () => {
    process.env.PORT = '3001';
    const pluginModule = await import('../../src/index.ts');
    const api = {
      pluginConfig: { workspaceRoot: '/tmp/mteam-test', dashboardEnabled: true, dashboardPort: 39123 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
      registerTool: vi.fn(),
    } as never;

    pluginModule.default.register(api);

    expect(startDashboardMock).toHaveBeenCalledWith('/tmp/mteam-test', 39123);
    expect(registerDashboardCleanupMock).toHaveBeenCalledOnce();
  });

  test('falls back to env port when config port is absent', async () => {
    process.env.PORT = '3001';
    const pluginModule = await import('../../src/index.ts');
    const api = {
      pluginConfig: { workspaceRoot: '/tmp/mteam-test', dashboardEnabled: true },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
      registerTool: vi.fn(),
    } as never;

    pluginModule.default.register(api);

    expect(startDashboardMock).toHaveBeenCalledWith('/tmp/mteam-test', 3001);
  });
});
