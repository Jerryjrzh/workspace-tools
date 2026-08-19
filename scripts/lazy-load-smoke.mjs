#!/usr/bin/env node
/**
 * lazy-load-smoke.mjs — 懒加载 + model-driven discovery 行为实测
 *
 * A. execution-time lazy loading（模块懒加载）：
 *   1. core 工具首次调用动态 import，返回 handler
 *   2. ops(未启用组)工具也能按需自动路由（registry 层面）
 *   3. session_start/ssh_session 静态归属判断无需加载
 *   4. 未知工具返回 null
 *   5. 重复 loadModule 命中缓存（同一命名空间 + handler 可用）
 *
// B. model-driven discovery（Capability Discovery / Tool Help，review4）：
//   6. workspace_discover 属 core → 默认 ListTools 可见
//   7. listCapabilities(need) 返回候选能力目录（精简 schema: summary/usage/examples）
//   8. getCapability(tool) 单工具帮助（精简 schema，无 when_to_use/category）
//   9. promoteTool() 递增 toolSetVersion（幂等）+ onChanged 通知
//  10. listEnabledTools({}, capabilitySet) 注入 promoted ops schema
//  11. isToolEnabled(promoted, {}, capabilitySet).enabled === true
 *
 * 运行：node scripts/lazy-load-smoke.mjs
 */
import { getToolHandler, loadModule, toolGroupOf } from '../src/tools/registry.js';
import { listEnabledTools, isToolEnabled } from '../src/tools/groups.js';
import {
  CapabilityRegistry,
  discover,
  promoteTool,
  capabilitySet,
  ToolCapabilitySet
} from '../src/tools/discovery.js';

let pass = 0;
const fail = [];
function check(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); pass += 1; }
  else { console.log(`  ❌ ${name}`); fail.push(name); }
}

console.log('=== A. execution-time lazy loading ===');

// 1. core 工具首次调用 → handler
const fileHandler = await getToolHandler('file_read');
check('core: file_read 返回 handler', typeof fileHandler === 'function');

// 2. ops(默认未启用)工具也能按需自动路由（registry 层面）
const shellHandler = await getToolHandler('shell_run');
check('ops: shell_run 按需自动路由 → handler', typeof shellHandler === 'function');

// 3. session_start 归 core，ssh_session 属 ops —— 静态判断无需加载
check('toolGroupOf(session_start) = core', toolGroupOf('session_start') === 'core');
check('toolGroupOf(ssh_session)    = ops',  toolGroupOf('ssh_session') === 'ops');

// 4. 未知工具 → null
const unknown = await getToolHandler('no_such_tool_xyz');
check('未知工具返回 null', unknown === null);

// 5. 缓存命中：同一模块重复加载返回同一命名空间，且无副作用错误
const firstNs = await loadModule('file');       // 首次
const secondNs = await loadModule('file');      // 再次 → 应命中缓存
check('重复 loadModule("file") 返回同一命名空间（ESM 单例 + 缓存）',
      firstNs === secondNs && typeof firstNs?.handleFileTools === 'function');

console.log('\n=== B. model-driven discovery (Capability Discovery / Tool Help) ===');

// 6. workspace_discover 属 core → 默认 ListTools 可见
const defaultList = await listEnabledTools({});
const names = defaultList.tools.map((t) => t.name);
check('workspace_discover 属 core', toolGroupOf('workspace_discover') === 'core');
check('默认 ListTools 含 workspace_discover', names.includes('workspace_discover'));
check('默认 ListTools 不含 shell_run(ops)', !names.includes('shell_run'));

// 7. listCapabilities(need) → 候选能力目录（精简 schema: {id, summary}，不 import）
const caps = CapabilityRegistry.listCapabilities('execute pwd');
check(`listCapabilities("execute pwd") 命中 ${caps.length} 项`, caps.some((c) => c.id === 'shell_run'));
// review5：仅 {id, summary}，无 usage/examples
check('候选含 summary（精简 schema）',
      caps.every((c) => typeof c.summary === 'string' && !('usage' in c) && !('examples' in c)));
check('listCapabilities() 空 need 返回全部候选', CapabilityRegistry.all().length >= 10);
// discover(need) 兼容旧 API
const matches = discover('execute pwd');
check(`discover("execute pwd") 命中 ${matches.length} 项`, matches.some((m) => m.id === 'shell_run'));

// 8. getCapability(tool) → 单工具帮助（精简 schema: {id, summary}）
const help = CapabilityRegistry.getCapability('shell_run');
check('getCapability(shell_run) 返回精简帮助',
      help && typeof help.summary === 'string' && !('usage' in help));
// review5：不再有 usage/examples/when_to_use/category（不做过度设计）
check('精简 schema 不含 usage/examples/when_to_use/category',
      !('usage' in (help || {})) && !('examples' in (help || {}))
      && !('when_to_use' in (help || {})) && !('category' in (help || {})));
check('getCapability 未知工具 → null', CapabilityRegistry.getCapability('no_such') === null);

// 9. promoteTool() 递增 toolSetVersion（幂等）+ onChanged 通知
const v0 = capabilitySet.version;
let notified = false;
capabilitySet.onChanged(({ toolSetVersion }) => { notified = true; });
promoteTool('shell_run');
promoteTool('tmux_list');
check(`promote 后 version ${v0} → ${capabilitySet.version}`, capabilitySet.version === v0 + 2);
check('onChanged 通知已触发（in-session refresh）', notified === true);
promoteTool('shell_run'); // 重复 promote → 幂等，version 不变
check('重复 promote(shell_run) 幂等（version 不增）', capabilitySet.version === v0 + 2);

// 10. listEnabledTools({}, capabilitySet) 注入 promoted ops schema
const afterList = await listEnabledTools({}, capabilitySet);
const afterNames = afterList.tools.map((t) => t.name);
check('promote 后 ListTools 含 shell_run', afterNames.includes('shell_run'));
check('promote 后 ListTools 含 tmux_list', afterNames.includes('tmux_list'));

// 11. isToolEnabled(promoted, {}, capabilitySet).enabled === true
const promotedCheck = isToolEnabled('shell_run', {}, capabilitySet);
check('isToolEnabled(shell_run, {}, capset) → enabled', promotedCheck.enabled === true);

// 12. ToolCapabilitySet 独立实例（可隔离测试）
const fresh = new ToolCapabilitySet();
fresh.promote('env_check');
check('独立 ToolCapabilitySet 不污染全局', capabilitySet.has('env_check') === false && fresh.has('env_check'));

console.log('\n=== C. review5: workspace_discover handler（capabilities[] + example）===');

// 13. handleDiscoveryTools({need}) → capabilities[] + example
import { handleDiscoveryTools } from '../src/tools/discovery.js';
const disc = await handleDiscoveryTools('workspace_discover', { need: 'execute pwd' });
check('handler 返回 status=capabilities', disc.status === 'capabilities');
check('capabilities[] 含 shell_run（{id, summary}）',
      Array.isArray(disc.capabilities) && disc.capabilities.some((c) => c.id === 'shell_run')
      && typeof disc.capabilities[0].summary === 'string'
      && !('usage' in disc.capabilities[0]));
// review5：完整 lazy-load example（need → select → call）
check('返回 example.need', typeof disc.example?.need === 'string');
check('example.select = shell_run', disc.example?.select === 'shell_run');
check('example.call 含 pwd', typeof disc.example?.call === 'string' && disc.example.call.includes('pwd'));

// 14. handler 空结果 → empty（无 no_match + hint）
const emptyRes = await handleDiscoveryTools('workspace_discover', { need: '量子计算能力' });
check('空结果返回 status=empty', emptyRes.status === 'empty');
check('不再有 no_capability/hint', !('no_capability' in emptyRes) && !('hint' in emptyRes));

console.log(`\n${pass}/${pass + fail.length} 项通过` +
            (fail.length ? `，失败: ${fail.join(', ')}` : ''));
