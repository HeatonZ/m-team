import { describe, expect, test } from 'vitest';
import pluginManifest from '../../openclaw.plugin.json' with { type: 'json' };

const EXPECTED_TOOL_NAMES = [
  'mteam_publish_task',
  'mteam_claim_task',
  'mteam_next_task',
  'mteam_relinquish_task',
  'mteam_get_task',
  'mteam_get_pending',
  'mteam_cancel_task',
  'mteam_get_agent_active',
  'mteam_get_all_tasks',
  'mteam_close_task',
  'mteam_reject_task',
];

describe('m-team manifest contract', () => {
  test('declares required metadata and tool contracts', () => {
    expect(pluginManifest.id).toBe('m-team');
    expect(pluginManifest.name).toBeTruthy();
    expect(pluginManifest.version).toBeTruthy();
    expect(pluginManifest.configSchema?.properties?.workspaceRoot).toBeTruthy();
    expect(pluginManifest.skills).toEqual([
      './skills/m-team-publisher',
      './skills/m-team-executor',
    ]);
    expect(pluginManifest.contracts?.tools).toEqual(EXPECTED_TOOL_NAMES);
  });
});
