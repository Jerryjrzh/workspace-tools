// Consolidated tool exports from all tool modules

const { workspaceTools } = require('./workspace.js');
const { fileTools } = require('./file.js');
const { gitTools } = require('./git.js');
const { shellTools } = require('./shell.js');
const { taskTools } = require('./task.js');
const { contextTools } = require('./context.js');
const { contextLoadTools } = require('./context_load.js');
const { embeddingTools } = require('./embedding.js');
const { reviewTools } = require('./review.js');
const { tmuxTools } = require('./tmux.js');
const { sessionTools } = require('./session.js');
const { envTools } = require('./env.js');

const { handleWorkspaceTools } = require('./workspace.js');
const { handleFileTools } = require('./file.js');
const { handleGitTools } = require('./git.js');
const { handleShellTools } = require('./shell.js');
const { handleTaskTools } = require('./task.js');
const { handleContextTools } = require('./context.js');
const { handleContextLoadTools } = require('./context_load.js');
const { handleEmbeddingTools } = require('./embedding.js');
const { handleReviewTools } = require('./review.js');
const { handleTmuxTools } = require('./tmux.js');
const { handleSessionTools } = require('./session.js');
const { handleEnvTools } = require('./env.js');

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
  
  // Env tools
  env_check: handleEnvTools
};

/**
 * Get all available tools for listing
 */
export const ALL_TOOLS = [
  ...workspaceTools,
  ...fileTools,
  ...gitTools,
  ...shellTools,
  ...taskTools,
  ...contextTools,
  ...contextLoadTools,
  ...embeddingTools,
  ...reviewTools,
  ...tmuxTools,
  ...sessionTools,
  ...envTools
];
