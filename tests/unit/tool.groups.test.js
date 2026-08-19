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

test('listEnabledTools 默认返回 core 工具，不含 ops', async () => {
  const { tools } = await listEnabledTools({});
  const names = tools.map((t) => t.name);
  for (const name of CORE_TOOLS) {
    assert.ok(names.includes(name), `core 应包含 ${name}`);
  }
  for (const name of OPS_TOOLS) {
    assert.ok(!names.includes(name), `默认不应包含 ops: ${name}`);
  }
});

test('启用 core+ops 后运维工具被注入', async () => {
  const { tools } = await listEnabledTools({ tools: { groups: ['core', 'ops'] } });
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

test('环境变量 WORKSPACE_TOOLS_GROUPS=core,ops 生效', async () => {
  process.env.WORKSPACE_TOOLS_GROUPS = 'core,ops';
  const { tools } = await listEnabledTools({});
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('tmux_run'));
  delete process.env.WORKSPACE_TOOLS_GROUPS;
});

test('空配置回退到默认 core', () => {
  // server options 传了空数组时应回退默认
  const groups = resolveEnabledGroups({ tools: { groups: [] } });
  assert.deepEqual(groups, DEFAULT_GROUPS);
});


// ── Model-driven discovery (review2: Capability Discovery / Tool Help) ──
import {
  CapabilityRegistry,
  discover,
  ToolCapabilitySet
} from '../../src/tools/discovery.js';

test('workspace_discover 属 core → 默认 ListTools 可见', async () => {
  const { tools } = await listEnabledTools({});
  assert.ok(tools.some((t) => t.name === 'workspace_discover'),
            'core 广告面应含 workspace_discover');
});

test('CapabilityRegistry Level1: listCapabilities(need) 返回候选能力目录', () => {
  const caps = CapabilityRegistry.listCapabilities('execute pwd');
  assert.ok(caps.some((c) => c.id === 'shell_run'), 'need 候选应含 shell_run');
  // review5：精简 schema —— {id, summary}，无 usage/examples
  assert.ok(caps.every((c) =>
    typeof c.summary === 'string' && !('usage' in c) && !('examples' in c)));
  // 空 need → 全部可发现候选
  assert.ok(CapabilityRegistry.all().length >= 10);
});

test('CapabilityRegistry: getCapability(tool) 单工具帮助（精简 schema）', () => {
  const help = CapabilityRegistry.getCapability('shell_run');
  // review5：仅 {id, summary}
  assert.ok(help && typeof help.summary === 'string' && !('usage' in help));
  // 未知工具 → null
  assert.equal(CapabilityRegistry.getCapability('no_such_tool'), null);
});

test('discover(need) 兼容旧 API：返回候选能力目录（不加载模块）', () => {
  const matches = discover('execute pwd');
  assert.ok(matches.some((m) => m.id === 'shell_run'));
});

test('promote 后 ops 工具注入广告面且可调用（独立 capset）', async () => {
  const fresh = new ToolCapabilitySet();
  fresh.promote('shell_run');
  fresh.promote('tmux_list');

  // ListTools：promoted schema 被注入
  const { tools } = await listEnabledTools({}, fresh);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('shell_run'), 'promote 后应含 shell_run');
  assert.ok(names.includes('tmux_list'), 'promote 后应含 tmux_list');

  // CallTool 守卫：promoted 工具视为可用
  const check = isToolEnabled('shell_run', {}, fresh);
  assert.equal(check.enabled, true);

  // toolSetVersion 递增（幂等）
  const v0 = fresh.version;
  fresh.promote('env_check');
  assert.ok(fresh.version > v0, 'promote 应递增 version');
});



// ── review4 T1-T3：workspace_discover 重构验证 ───────────────────────
import { handleDiscoveryTools, discoveryTools } from '../../src/tools/discovery.js';

test('T1/T3: workspace_discover({need}) 返回 capabilities[] + example，不做选择、不自动 promote', async () => {
  const res = await handleDiscoveryTools('workspace_discover', { need: 'execute pwd' });
  assert.equal(res.status, 'capabilities');
  assert.ok(Array.isArray(res.capabilities));
  assert.ok(res.capabilities.some((c) => c.id === 'shell_run'));
  // review5：精简 schema —— {id, summary}，无 usage/examples/when_to_use/category
  for (const c of res.capabilities) {
    assert.equal(typeof c.summary, 'string');
    assert.equal('usage' in c, false);
    assert.equal('examples' in c, false);
    assert.equal('when_to_use' in c, false);
    assert.equal('category' in c, false);
  }
  // review5：返回完整 lazy-load example（need → select → call）
  assert.ok(res.example && typeof res.example.need === 'string');
  assert.ok(res.example.select === 'shell_run');
  assert.ok(typeof res.example.call === 'string' && res.example.call.includes('pwd'));
});

test('T3: workspace_discover({need}) 空结果返回 empty，不再有 no_match + retry hint', async () => {
  const res = await handleDiscoveryTools('workspace_discover', { need: '量子计算能力' });
  assert.equal(res.status, 'empty');
  // review4 T3：删除 no_capability / hint（诱导换关键词重试）
  assert.notEqual(res.status, 'no_capability');
  assert.equal('hint' in res, false);
});

test('T1: workspace_discover 不再接受 select/promote（模型协议不含 promote）', async () => {
  // review4 T5：promote 是 Runtime 内部动作，不作为模型协议的一部分。
  const schema = discoveryTools[0].inputSchema.properties;
  assert.equal('select' in schema, false);
  assert.equal('tool' in schema, false);
  assert.ok(schema.need, '输入参数应为 need');
});

