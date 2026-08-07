// Consolidated tool exports from all tool modules
//
// 工具按需加载 / 分组路由：
//   - ALL_TOOLS 保持全量（向后兼容，供内部/测试使用）
//   - TOOL_GROUPS + listEnabledTools() 用于 MCP ListTools 的按组注入
//   - server.js 默认仅暴露 core 组；ops(运维)组需显式启用

import { workspaceTools } from './workspace.js';
import { fileTools } from './file.js';
import { gitTools } from './git.js';
import { shellTools } from './shell.js';
import { taskTools } from './task.js';
import { contextTools } from './context.js';
import { contextLoadTools } from './context_load.js';
import { embeddingTools } from './embedding.js';
import { reviewTools } from './review.js';
import { tmuxTools } from './tmux.js';
import { sessionTools } from './session.js';
import { envTools } from './env.js';
import { memoryTools } from './memory.js';
import { contextCompactTools } from './contextCompact.js';
import { searchTools } from './search.js';

import { handleWorkspaceTools } from './workspace.js';
import { handleFileTools } from './file.js';
import { handleGitTools } from './git.js';
import { handleShellTools } from './shell.js';
import { handleTaskTools } from './task.js';
import { handleContextTools } from './context.js';
import { handleContextLoadTools } from './context_load.js';
import { handleEmbeddingTools } from './embedding.js';
import { handleReviewTools } from './review.js';
import { handleTmuxTools } from './tmux.js';
import { handleSessionTools } from './session.js';
import { handleEnvTools } from './env.js';
import { handleMemoryTools } from './memory.js';
import { handleContextCompactTools } from './contextCompact.js';
import { handleSearchTools } from './search.js';

/**
 * Route tool calls to appropriate handlers based on tool name
 */
export const toolHandlers = {
  // Workspace tools
  workspace_set: handleWorkspaceTools,
  workspace_clear: handleWorkspaceTools,
  workspace_info: handleWorkspaceTools,
  
  // File tools
  file_read: handleFileTools,
  file_write: handleFileTools,
  file_append: handleFileTools,
  file_patch: handleFileTools,
  file_delete_lines: handleFileTools,
  file_rollback: handleFileTools,

  // Search tools
  locate: handleSearchTools,
  file_search: handleSearchTools,
  glob_search: handleSearchTools,
  
  // Git tools
  git_status: handleGitTools,
  git_diff: handleGitTools,
  git_commit: handleGitTools,
  git_branch: handleGitTools,
  git_stash: handleGitTools,
  git_log: handleGitTools,
  
  // Shell tools
  shell_run: handleShellTools,
  process_start: handleShellTools,
  process_output: handleShellTools,
  process_kill: handleShellTools,
  process_list_bg: handleShellTools,
  
  // Task tools
  task_checkpoint: handleTaskTools,
  task_resume: handleTaskTools,
  task_list: handleTaskTools,
  
  // Context tools
  context_anchor: handleContextTools,
  
  // Context load tools
  context_load: handleContextLoadTools,
  context_summary: handleContextLoadTools,
  
  // Embedding tools
  lm_embed: handleEmbeddingTools,
  semantic_search: handleEmbeddingTools,
  embed_files: handleEmbeddingTools,
  
  // Review tools
  lm_review: handleReviewTools,
  
  // TMUX tools
  tmux_run: handleTmuxTools,
  tmux_send: handleTmuxTools,
  tmux_capture: handleTmuxTools,
  tmux_list: handleTmuxTools,
  tmux_new_session: handleTmuxTools,
  tmux_kill: handleTmuxTools,
  
  // Session tools
  ssh_session: handleSessionTools,
  serial_session: handleSessionTools,
  session_start: handleSessionTools,
  
  // Env tools
  env_check: handleEnvTools,

  // Memory tools
  memory_remember: handleMemoryTools,
  memory_forget: handleMemoryTools,
  memory_search: handleMemoryTools,

  // Context compact tools
  session_context_compact: handleContextCompactTools
};

/**
 * Get all available tools for listing
 */
export const ALL_TOOLS = [
  ...workspaceTools,
  ...fileTools,
  ...searchTools,
  ...gitTools,
  ...shellTools,
  ...taskTools,
  ...contextTools,
  ...contextLoadTools,
  ...embeddingTools,
  ...reviewTools,
  ...tmuxTools,
  ...sessionTools,
  ...envTools,
  ...memoryTools,
  ...contextCompactTools
];


// ── Tool Group Routing (按需加载 / 分组路由) ─────────────────────────
export {
  TOOL_GROUPS,
  DEFAULT_GROUPS,
  resolveEnabledGroups,
  listEnabledTools,
  isToolEnabled
} from './groups.js';

