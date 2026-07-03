// src/tools/index.js
// Consolidated tool exports from all tool modules

import { workspaceTools } from './workspace.js';
import { fileTools } from './file.js';
import { gitTools } from './git.js';
import { shellTools } from './shell.js';
import { handleWorkspaceTools } from './workspace.js';
import { handleFileTools } from './file.js';
import { handleGitTools } from './git.js';
import { handleShellTools } from './shell.js';

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
  process_list_bg: handleShellTools
};

/**
 * Get all available tools for listing
 */
export const ALL_TOOLS = [
  ...workspaceTools,
  ...fileTools,
  ...gitTools,
  ...shellTools
];