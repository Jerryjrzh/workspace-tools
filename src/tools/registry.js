// src/tools/registry.js - 工具按需加载注册表 (Lazy Loading Registry)
//
// 设计目标：core 工具在会话开始时加载，二级(ops)工具在使用时才动态 import。
//
// 本文件是唯一的静态元数据源（不 import 任何工具模块），提供：
//   - TOOL_TO_MODULE : toolName → moduleKey（静态路由表，无需加载即可定位）
//   - MODULES        : moduleKey → { path, toolsExport, handlerExport }
//   - GROUP_MODULES  : group     → [moduleKey]
//   - loadModule()   : 动态 import + 缓存
//   - getToolHandler(): 首次调用时按需加载对应模块并返回 handler（自动路由）
//
// 这样即使某个工具尚未被预加载（例如未启用的 ops 组），一旦被调用，
// 也会通过 TOOL_TO_MODULE 定位到所属模块并动态 import，实现"缺少即自动路由"。

/** toolName → moduleKey：静态路由表（与旧 index.js 的 toolHandlers 一一对应） */
export const TOOL_TO_MODULE = {
  // workspace
  workspace_set: 'workspace',
  workspace_clear: 'workspace',
  workspace_info: 'workspace',

  // file
  file_read: 'file',
  file_write: 'file',
  file_append: 'file',
  file_patch: 'file',
  file_delete_lines: 'file',
  file_rollback: 'file',

  // search
  locate: 'search',
  file_search: 'search',
  glob_search: 'search',

  // git
  git_status: 'git',
  git_diff: 'git',
  git_commit: 'git',
  git_branch: 'git',
  git_stash: 'git',
  git_log: 'git',

  // shell (ops)
  shell_run: 'shell',
  process_start: 'shell',
  process_output: 'shell',
  process_kill: 'shell',
  process_list_bg: 'shell',

  // task
  task_checkpoint: 'task',
  task_resume: 'task',
  task_list: 'task',

  // context
  context_anchor: 'context',

  // discovery (core，能力发现入口)
  workspace_discover: 'discovery',

  // context_load
  context_load: 'context_load',
  context_summary: 'context_load',

  // embedding
  lm_embed: 'embedding',
  semantic_search: 'embedding',
  embed_files: 'embedding',

  // review
  lm_review: 'review',

  // tmux (ops)
  tmux_run: 'tmux',
  tmux_send: 'tmux',
  tmux_capture: 'tmux',
  tmux_list: 'tmux',
  tmux_new_session: 'tmux',
  tmux_kill: 'tmux',

  // session（session_start 属 core，ssh/serial 属 ops）
  ssh_session: 'session',
  serial_session: 'session',
  session_start: 'session',

  // env (ops)
  env_check: 'env',

  // memory
  memory_remember: 'memory',
  memory_forget: 'memory',
  memory_search: 'memory',

  // contextCompact
  session_context_compact: 'contextCompact'
};

/** moduleKey → { path, toolsExport, handlerExport } */
export const MODULES = {
  workspace:      { path: './workspace.js',       tools: 'workspaceTools',      handlers: 'handleWorkspaceTools' },
  file:           { path: './file.js',            tools: 'fileTools',           handlers: 'handleFileTools' },
  search:         { path: './search.js',          tools: 'searchTools',         handlers: 'handleSearchTools' },
  git:            { path: './git.js',             tools: 'gitTools',            handlers: 'handleGitTools' },
  shell:          { path: './shell.js',           tools: 'shellTools',          handlers: 'handleShellTools' },
  task:           { path: './task.js',            tools: 'taskTools',           handlers: 'handleTaskTools' },
  context:        { path: './context.js',         tools: 'contextTools',        handlers: 'handleContextTools' },
  discovery:      { path: './discovery.js',       tools: 'discoveryTools',      handlers: 'handleDiscoveryTools' },
  context_load:   { path: './context_load.js',    tools: 'contextLoadTools',    handlers: 'handleContextLoadTools' },
  embedding:      { path: './embedding.js',       tools: 'embeddingTools',      handlers: 'handleEmbeddingTools' },
  review:         { path: './review.js',          tools: 'reviewTools',         handlers: 'handleReviewTools' },
  tmux:           { path: './tmux.js',            tools: 'tmuxTools',           handlers: 'handleTmuxTools' },
  session:        { path: './session.js',         tools: 'sessionTools',        handlers: 'handleSessionTools' },
  env:            { path: './env.js',             tools: 'envTools',            handlers: 'handleEnvTools' },
  memory:         { path: './memory.js',          tools: 'memoryTools',         handlers: 'handleMemoryTools' },
  contextCompact: { path: './contextCompact.js',  tools: 'contextCompactTools', handlers: 'handleContextCompactTools' }
};

/**
 * group → [moduleKey]
 *
 * ⚠️ session 模块同时出现在 core 与 ops：其中仅 session_start 属 core，
 * ssh_session / serial_session 属 ops。归属判断见 toolGroupOf()。
 */
export const GROUP_MODULES = {
  // core: 开发常用 + bootstrap，默认始终加载
  core: [
    'workspace', 'file', 'search', 'git',
    'context', 'discovery', 'context_load', 'embedding', 'review',
    'memory', 'task', 'contextCompact', 'session'
  ],
  // ops: 运维扩展（shell process / tmux / ssh-serial / env），按需启用
  ops: ['shell', 'tmux', 'session', 'env']
};

/** 已加载模块缓存：moduleKey → module namespace */
const loadedModules = new Map();

/**
 * 动态 import + 缓存。首次调用才真正加载对应工具模块。
 *
 * @param {string} key - MODULES 的键
 * @returns {Promise<Object>} 模块命名空间
 */
export async function loadModule(key) {
  if (loadedModules.has(key)) return loadedModules.get(key);
  const def = MODULES[key];
  if (!def) throw new Error(`[registry] Unknown module: ${key}`);
  const mod = await import(def.path);
  loadedModules.set(key, mod);
  return mod;
}

/**
 * 按需加载工具 handler（自动路由）。
 *
 * 通过静态 TOOL_TO_MODULE 定位所属模块，首次调用时动态 import，
 * 之后命中缓存。找不到返回 null。
 *
 * @param {string} toolName
 * @returns {Promise<Function|null>}
 */
export async function getToolHandler(toolName) {
  const key = TOOL_TO_MODULE[toolName];
  if (!key) return null;
  const mod = await loadModule(key);
  return mod[MODULES[key].handlers] || null;
}

/**
 * 判断工具所属组（静态，无需加载模块）。
 *
 * @param {string} toolName
 * @returns {string|null} 'core' | 'ops' | null(未知)
 */
export function toolGroupOf(toolName) {
  const key = TOOL_TO_MODULE[toolName];
  if (!key) return null;
  // session_start 是 bootstrap 核心，必须归入 core
  if (toolName === 'session_start') return 'core';
  if (GROUP_MODULES.ops.includes(key)) return 'ops';
  return 'core';
}

export default { TOOL_TO_MODULE, MODULES, GROUP_MODULES, loadModule, getToolHandler, toolGroupOf };
