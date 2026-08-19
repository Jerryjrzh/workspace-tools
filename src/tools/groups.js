
// 工具按需加载 / 分组路由 (Tool Group Routing)
//
// 默认仅注入 core 组（开发常用：workspace/file/search/git/context/memory/
// embedding/review/task + bootstrap 的 session_start），运维类扩展工具
// （shell process、tmux、ssh/serial、env）归入 ops 组，仅在显式启用后
// 才会暴露给模型。
//
// ⚠️ 重要：session_start 是 bootstrap 生命周期核心（初始化会话/加载规则/
//    解析工作区），必须始终可用 → 归入 core。仅 ssh_session/serial_session
//    属于运维扩展，留在 ops。
//
// 启用方式（优先级从高到低）：
//   1. MCP server options:   { tools: { groups: ['core','ops'] } }
//   2. 环境变量:            WORKSPACE_TOOLS_GROUPS=core,ops
//      （逗号分隔；空/未设置 = core）
//
// ⚠️ 懒加载说明：本文件不再静态 import 任何工具模块。工具定义（schema）与
//     handler 均通过 registry.loadModule() 在使用时动态 import：
//       - listEnabledTools()  按启用组按需加载对应模块的定义（async）
//       - isToolEnabled()     基于静态 TOOL_TO_MODULE 判断，无需加载
//       因此未启用的 ops 工具不会在启动时被加载进内存。

import {
  TOOL_TO_MODULE,
  GROUP_MODULES,
  MODULES,
  loadModule,
  toolGroupOf
} from './registry.js';

/**
 * 工具组定义：group → [moduleKey]（静态元数据，不触发模块加载）。
 * 兼容旧 TOOL_GROUPS 的键名用法；具体工具列表由 listEnabledTools() 按需展开。
 */
export const TOOL_GROUPS = GROUP_MODULES;

/** 默认启用的组 */
export const DEFAULT_GROUPS = ['core'];

/**
 * 解析配置，返回最终启用的工具组名列表。
 *
 * @param {Object} [options] - MCP server options（tools.groups）
 * @returns {string[]} 启用组名数组
 */
export function resolveEnabledGroups(options) {
  // 1. server options 优先（显式提供且非空时采用）
  const fromOptions = options?.tools?.groups;
  if (Array.isArray(fromOptions)) {
    const normalized = normalizeGroupList(fromOptions);
    return normalized.length > 0 ? normalized : [...DEFAULT_GROUPS];
  }

  // 2. 环境变量兜底（逗号分隔）
  const envValue = process.env.WORKSPACE_TOOLS_GROUPS || '';
  if (envValue.trim()) {
    const normalized = normalizeGroupList(envValue.split(','));
    return normalized.length > 0 ? normalized : [...DEFAULT_GROUPS];
  }

  // 3. 默认 core
  return [...DEFAULT_GROUPS];
}

/**
 * 规范化组名列表：过滤非法组、去重。
 */
export function normalizeGroupList(list) {
  const seen = new Set();
  for (const raw of list || []) {
    const g = String(raw).trim().toLowerCase();
    if (!g) continue;
    if (!TOOL_GROUPS[g]) continue; // 未知组忽略
    seen.add(g);
  }
  return [...seen];
}

/**
 * 返回当前启用的全部工具（用于 ListTools）。
 *
 * ⚠️ async：按启用组动态 import 对应模块的定义，未启用的组不会加载。
 *
 * @param {Object} [options] - server options
 * @param {ToolCapabilitySet} [capabilitySet] - 已 promote 的能力集（可选）
 *   promoted 工具即使属于未启用组也会被注入广告面 → 模型可见可调用。
 * @returns {Promise<{ tools: Object[] }>} MCP ListTools 响应体
 */
export async function listEnabledTools(options, capabilitySet) {
  const groups = resolveEnabledGroups(options);
  const tools = [];
  for (const g of groups) {
    for (const modKey of GROUP_MODULES[g] || []) {
      const mod = await loadModule(modKey);
      const defs = mod[MODULES[modKey].tools] || [];
      // session 模块跨组：仅保留属于当前组的工具（session_start→core，ssh/serial→ops）
      for (const t of defs) {
        if (toolGroupOf(t.name) === g) tools.push(t);
      }
    }
  }

  // ── promoted(discoverable) 能力集：注入已提升的 ops 工具 schema ──
  // module loaded ≠ tool promoted；此处仅当工具被 workspace_discover promote
  // 后才展开其 schema（此时 import 属 execution-time lazy loading，合理）。
  if (capabilitySet && capabilitySet.getPromoted().length > 0) {
    for (const name of capabilitySet.getPromoted()) {
      const key = TOOL_TO_MODULE[name];
      if (!key || groups.includes(toolGroupOf(name))) continue; // core/已启用组跳过
      const mod = await loadModule(key);
      const defs = mod[MODULES[key].tools] || [];
      for (const t of defs) {
        if (t.name === name && !tools.some((x) => x.name === name)) tools.push(t);
      }
    }
  }

  return { tools };
}

/**
 * 判断某个工具是否属于已启用组或已被 promote。
 *
 * 基于静态 TOOL_TO_MODULE，无需加载模块即可同步判断。
 *
 * @param {string} toolName
 * @param {Object} [options]
 * @param {ToolCapabilitySet} [capabilitySet] - promoted 能力集（可选）
 *   已 promote 的 ops 工具视为可用（可执行）。
 * @returns {{ enabled: boolean, group?: string }}
 */
export function isToolEnabled(toolName, options, capabilitySet) {
  const groups = resolveEnabledGroups(options);
  const g = toolGroupOf(toolName);

  // 工具属于某个已启用组 → 可用
  if (g && groups.includes(g)) {
    return { enabled: true, group: g };
  }

  // 已被 workspace_discover promote → 可用（即使所属组未启用）
  if (capabilitySet && capabilitySet.has(toolName)) {
    return { enabled: true, group: g || 'ops' };
  }

  // 工具已知但不在任何启用组（如默认禁用的 ops）→ 禁用
  if (g) {
    return { enabled: false, group: null };
  }

  // 未知工具 → 视为 core（保持兼容）
  return { enabled: true, group: 'core' };
}

export default TOOL_GROUPS;
