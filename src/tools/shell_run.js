// src/tools/shell_run.js - Slimmed tool following new contract
// Only does business logic, trusts ctx.workspace

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * shell_run tool - Slim version
 * 
 * Contract:
 * - Input: (ctx, args) where ctx.workspace is Single Source of Truth
 * - Output: { stdout, stderr }
 * - No path resolution - all done in Stage
 */
export async function shell_run(ctx, args) {
  // Trust ctx.workspace (set by WorkspaceStage)
  const ws = ctx.workspace;
  if (!ws) {
    throw new Error('[shell_run] Workspace not set in context');
  }

  const cwd = args.cwd || ws;
  
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: cwd,
      timeout: (args.timeout_seconds || 300) * 1000
    });
    
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      stdout: error.stdout ? error.stdout.trim() : '',
      stderr: error.stderr ? error.stderr.trim() : error.message
    };
  }
}
