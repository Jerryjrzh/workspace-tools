// src/tools/groups.js
// 工具按需加载 / 分组路由 (Tool Group Routing)
//
// 默认仅注入 core 组（开发常用：workspace/file/search/git/context/memory/
// embedding/review/task），运维类扩展工具（shell process、tmux、ssh/serial、
// env）归入 ops 组，仅在显式启用后才会暴露给模型。
//
// 启用方式（优先级从高到低）：
//   1. MCP server options:   { tools: { groups: ['core','ops'] } }
//   2. 环境变量:            WORKSPACE_TOOLS_GROUPS=core,ops
//      （逗号分隔；空/未设置 = core）
//
// 说明：toolHandlers 始终全量注册（路由层不删代码），仅 ListTools 暴露面
// 受分组控制，因此已启用组的工具可立即调用。

import { workspaceTools } from './workspace.js';
import { fileTools } from './file.js';
import { searchTools } from './search.js';
import { gitTools } from './git.js';
import { contextTools } from './context.js';
import { contextLoadTools } from './context_load.js';
import { embeddingTools } from './embedding.js';
import { reviewTools } from './review.js';
import { memoryTools } from './memory.js';
import { taskTools } from './task.js';
import { contextCompactTools } from './contextCompact.js';

// 运维类扩展工具（默认不加载）
import { shellTools } from './shell.js';
import { tmuxTools } from './tmux.js';
import { sessionTools } from './session.js';
import { envTools } from './env.js';

/**
 * 工具组定义：group → tool list
 */
export const TOOL_GROUPS = {
  // core: 开发常用，默认始终加载
  core: [
    ...workspaceTools,
    ...fileTools,
    ...searchTools,
    ...gitTools,
    ...contextTools,
    ...contextLoadTools,
    ...embeddingTools,
    ...reviewTools,
    ...memoryTools,
    ...taskTools,
    ...contextCompactTools
  ],
  // ops: 运维扩展（shell process / tmux / ssh-serial / env），按需启用
  ops: [
    ...shellTools,
    ...tmuxTools,
    ...sessionTools,
    ...envTools
  ]
};

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
 * @param {Object} [options] - server options
 * @returns {{ tools: Object[] }} MCP ListTools 响应体
 */
export function listEnabledTools(options) {
  const groups = resolveEnabledGroups(options);
  const tools = [];
  for (const g of groups) {
    tools.push(...(TOOL_GROUPS[g] || []));
  }
  return { tools };
}

/**
 * 判断某个工具是否属于已启用组。
 *
 * @param {string} toolName
 * @param {Object} [options]
 * @returns {{ enabled: boolean, group?: string }}
 */
export function isToolEnabled(toolName, options) {
  const groups = resolveEnabledGroups(options);
  for (const g of groups) {
    if ((TOOL_GROUPS[g] || []).some((t) => t.name === toolName)) {
      return { enabled: true, group: g };
    }
  }
  // 工具未在任何组中 → 视为 core（保持兼容）
  const known = Object.values(TOOL_GROUPS)
    .flat()
    .some((t) => t.name === toolName);
  if (!known) return { enabled: true, group: 'core' };
  return { enabled: false, group: null };
}

export default TOOL_GROUPS;
