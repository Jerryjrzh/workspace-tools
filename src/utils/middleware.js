// src/utils/middleware.js
import { workspaceManager } from '../managers/workspace.js';
import { ruleManager } from '../managers/rules.js';

/**
 * Middleware for tool execution context and security checks
 */
export class ToolMiddleware {
  /**
   * Prepare execution context for a tool call
   * @param {string} convId - Conversation ID
   * @param {string} toolName - Name of the tool being executed
   * @param {Object} args - Tool arguments
   * @returns {Object} - Execution context
   */
  static prepareContext(convId, toolName, args) {
    const workspace = workspaceManager.getWorkspaceForSession(convId);
    
    let projectRules = '';
    if (workspace && workspace !== process.cwd()) {
      try {
        projectRules = ruleManager.loadProject(workspace);
      } catch (e) {
        // Ignore if project rules don't exist
      }
    }

    return {
      workspace,
      projectRules,
      toolName,
      timestamp: new Date().toISOString(),
      convId
    };
  }

  /**
   * Security check for write operations
   * @param {string} toolName - Name of the tool
   * @param {Object} context - Execution context
   * @throws {Error} - If security check fails
   */
  static checkWriteOperationSecurity(toolName, context) {
    const isWriteTool = [
      'file_write', 
      'file_delete_lines', 
      'shell_run',
      'process_start',
      'tmux_run',
      'tmux_send',
      'ssh_session',
      'serial_session'
    ].includes(toolName);

    if (isWriteTool && (!context.workspace || context.workspace === process.cwd())) {
      throw new Error(
        `拦截器阻断：写操作必须在明确的 Workspace 中执行！\n` +
        `当前工作区: ${context.workspace || '未设置'}\n` +
        `请在执行修改前，显式调用 'workspace_set(path=\"xxx\")' 重建上下文。`
      );
    }
  }

  /**
   * Apply middleware to tool execution
   * @param {Function} toolExecutor - The actual tool function to execute
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @param {Object} extra - Extra parameters (may contain conversation_id)
   * @returns {Promise<any>} - Tool execution result
   */
  static async executeWithMiddleware(toolExecutor, name, args, extra = {}) {
    // Extract conversation ID from extra parameter
    const convId = extra?.conversation_id || 'default';
    
    // 1. Context mounting phase
    const context = this.prepareContext(convId, name, args);
    
    // 2. Permission/security check phase
    this.checkWriteOperationSecurity(name, context);
    
    // 3. Actual execution phase
    return await toolExecutor(name, args, context);
  }
}

export default ToolMiddleware;