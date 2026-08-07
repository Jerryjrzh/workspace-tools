import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_GROUPS,
  DEFAULT_GROUPS,
  resolveEnabledGroups,
  listEnabledTools,
  isToolEnabled
} from '../../src/tools/groups.js';

const CORE_TOOLS = [
  'workspace_set', 'file_read', 'locate', 'git_status',
  'context_load', 'lm_embed', 'memory_search', 'task_checkpoint'
];
const OPS_TOOLS = ['tmux_run', 'ssh_session', 'shell_run', 'env_check', 'serial_session'];

test('默认仅启用 core 组（不含运维工具）', () => {
  const groups = resolveEnabledGroups({});
  assert.deepEqual(groups, DEFAULT_GROUPS);
  assert.ok(groups.includes('core'));
});

test('listEnabledTools 默认返回 core 工具，不含 ops', () => {
  const { tools } = listEnabledTools({});
  const names = tools.map((t) => t.name);
  for (const name of CORE_TOOLS) {
    assert.ok(names.includes(name), `core 应包含 ${name}`);
  }
  for (const name of OPS_TOOLS) {
    assert.ok(!names.includes(name), `默认不应包含 ops: ${name}`);
  }
});

test('启用 core+ops 后运维工具被注入', () => {
  const { tools } = listEnabledTools({ tools: { groups: ['core', 'ops'] } });
  const names = tools.map((t) => t.name);
  for (const name of OPS_TOOLS) {
    assert.ok(names.includes(name), `启用 ops 后应包含 ${name}`);
  }
});

test('isToolEnabled：默认禁用运维工具，启用 ops 后可用', () => {
  const core = isToolEnabled('file_read', {});
  assert.equal(core.enabled, true);
  assert.equal(core.group, 'core');

  const disabledOps = isToolEnabled('tmux_run', {});
  assert.equal(disabledOps.enabled, false);

  const enabledOps = isToolEnabled('tmux_run', { tools: { groups: ['core', 'ops'] } });
  assert.equal(enabledOps.enabled, true);
});

test('环境变量 WORKSPACE_TOOLS_GROUPS=core,ops 生效', () => {
  process.env.WORKSPACE_TOOLS_GROUPS = 'core,ops';
  const { tools } = listEnabledTools({});
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('tmux_run'));
  delete process.env.WORKSPACE_TOOLS_GROUPS;
});

test('空配置回退到默认 core', () => {
  // server options 传了空数组时应回退默认
  const groups = resolveEnabledGroups({ tools: { groups: [] } });
  assert.deepEqual(groups, DEFAULT_GROUPS);
});
