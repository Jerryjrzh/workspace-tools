// src/middleware/sessionMiddleware.js
import { SessionResolver } from '../managers/sessionResolver.js';
import { sessionContextManager } from '../managers/sessionContext.js';
import { sessionContextPersistence } from '../managers/sessionContextPersistence.js';
import { workspaceManager } from '../managers/workspace.js';
import { ruleManager } from '../managers/rules.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/**
 * SessionMiddleware - 三层架构实现
 * 
 * Bootstrap Phase (不依赖 Session):
 * - workspace_set: 设置工作区
 * - session_start: 加载上下文（只读，不修改 workspace）
 * - workspace_info: 查看工作区信息
 * - load_global_rules: 加载全局规则
 * 
 * Context Ready Phase:
 * - SessionContext 已就绪
 * - workspace, task, rules 已加载
 * 
 * Business Tool Phase (需要完整 Context):
 * - file_read, file_patch, shell_run, etc.
 */

// Bootstrap tools - 不依赖 Session，可以修改状态
const BOOTSTRAP_TOOLS = new Set([
  'workspace_set',
  'session_start',
  'workspace_info',
  'load_global_rules',
  'workspace_clear'
]);

// Tools that need SessionContext but don't modify state
const CONTEXT_READY_TOOLS = new Set([
  // Placeholder for future context-only tools
]);

/**
 * SessionMiddleware - 三层架构
 */
export class SessionMiddleware {
  /**
   * 分层调用策略
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {string} conversationId - 会话 ID
   * @returns {Promise<Object>} - 执行结果
   */
  static async dispatch(toolName, args, conversationId) {
    // Step 1: 确定工具所在的层级
    const layer = this.getLayer(toolName);
    
    // Step 2: 根据层级执行
    switch (layer) {
      case 'bootstrap':
        return this.executeBootstrap(toolName, args, conversationId);
      
      case 'contextReady':
        return this.executeContextReady(toolName, args, conversationId);
      
      case 'business':
        return this.executeBusiness(toolName, args, conversationId);
      
      default:
        throw new Error(`Unknown tool layer for: ${toolName}`);
    }
  }

  /**
   * 确定工具所属层级
   * @param {string} toolName - 工具名称
   * @returns {string} - 层级名称
   */
  static getLayer(toolName) {
    if (BOOTSTRAP_TOOLS.has(toolName)) {
      return 'bootstrap';
    }
    if (CONTEXT_READY_TOOLS.has(toolName)) {
      return 'contextReady';
    }
    return 'business';
  }

  /**
   * Bootstrap 层 - 不依赖 Session
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {string} conversationId - 会话 ID
   * @returns {Promise<Object>} - 执行结果
   */
  static async executeBootstrap(toolName, args, conversationId) {
    const sessionId = await SessionResolver.resolve(conversationId);
    
    switch (toolName) {
      case 'workspace_set':
        return await this.handleWorkspaceSet(args, sessionId);
      
      case 'session_start':
        return await this.handleSessionStart(args, sessionId);
      
      case 'workspace_info':
        return await this.handleWorkspaceInfo(args, sessionId);
      
      case 'load_global_rules':
        return await this.handleLoadGlobalRules(args, sessionId);
      
      case 'workspace_clear':
        return await this.handleWorkspaceClear(args, sessionId);
      
      default:
        throw new Error(`Bootstrap tool not implemented: ${toolName}`);
    }
  }

  /**
   * Context Ready 层 - SessionContext 已就绪
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {string} conversationId - 会话 ID
   * @returns {Promise<Object>} - 执行结果
   */
  static async executeContextReady(toolName, args, conversationId) {
    // Get or create session context
    const sessionId = await SessionResolver.resolve(conversationId);
    const context = sessionContextManager.getOrCreateContext(sessionId);
    
    if (!context.workspace) {
      throw new Error('[ContextReady] Workspace not set. Please call workspace_set first.');
    }
    
    throw new Error(`Context Ready tool not implemented: ${toolName}`);
  }

  /**
   * Business 层 - 需要完整 Context
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {string} conversationId - 会话 ID
   * @returns {Promise<Object>} - 执行结果
   */
  static async executeBusiness(toolName, args, conversationId) {
    const context = await this.getContextForTool(toolName, args, conversationId);
    
    // Inject context into args
    const toolArgs = {
      ...args,
      context
    };
    
    // Return context for tool handler to use
    return { context, toolArgs };
  }

  /**
   * 获取工具所需的 Context
   * @param {string} toolName - 工具名称
   * @param {Object} args - 工具参数
   * @param {string} conversationId - 会话 ID
   * @returns {Promise<Object>} - 完整的 SessionContext
   */
  static async getContextForTool(toolName, args, conversationId) {
    // Step 1: Resolve session ID
    const sessionId = await SessionResolver.resolve(conversationId);
    
    // Step 2: Get or create session context
    let context = sessionContextManager.getContext(sessionId);
    
    // Step 3: If context exists in memory, use it
    if (context) {
      return this.buildFullContext(sessionId, context);
    }
    
    // Step 4: Try to load from persistence (zero-latency recovery)
    try {
      context = await sessionContextPersistence.load(sessionId);
    } catch (e) {
      console.warn(`[SessionMiddleware] Failed to load context from persistence: ${e.message}`);
    }
    
    // Step 5: If loaded from persistence, update memory cache
    if (context) {
      sessionContextManager.getOrCreateContext(sessionId);
      context = sessionContextManager.getContext(sessionId);
      return this.buildFullContext(sessionId, context);
    }
    
    // Step 6: If context doesn't exist, throw error
    throw new Error(`[SessionMiddleware] Session context not found for session ${sessionId}. Please call session_start first.`);
  }

  /**
   * workspace_set 处理 - Bootstrap 层
   * 只负责设置 workspace，不依赖 Session
   */
  static async handleWorkspaceSet(args, sessionId) {
    const workspacePath = args.path || 'auto';
    
    // Handle special paths
    let pathToSet;
    if (workspacePath === 'auto' || workspacePath === 'last') {
      // Get last workspace from global state
      pathToSet = workspaceManager.getWorkspace() || process.cwd();
    } else {
      pathToSet = workspacePath;
    }
    
    // Set workspace (this is the ONLY place that should modify workspace)
    const resolvedPath = workspaceManager.setSessionWorkspace(sessionId, pathToSet);
    
    // Update session context
    const context = sessionContextManager.getOrCreateContext(sessionId);
    context.workspace = resolvedPath;
    context.initialized = true; // Workspace is set
    
    // Persist context
    await sessionContextPersistence.save(sessionId, context);
    
    return {
      status: 'WORKSPACE_READY',
      workspace: resolvedPath,
      message: `✅ 工作区已设置: ${resolvedPath}`,
      details: {
        session_id: sessionId,
        mode: 'bootstrap',
        single_source_of_truth: 'SessionContext'
      }
    };
  }

  /**
   * session_start 处理 - Bootstrap 层
   * 只负责加载上下文，不修改 workspace
   */
  static async handleSessionStart(args, sessionId) {
    const context = sessionContextManager.getOrCreateContext(sessionId);
    
    // Validate workspace exists
    if (!context.workspace) {
      throw new Error('[SessionStart] Workspace not set. Please call workspace_set first.');
    }
    
    // Load conversation data
    const { conversationManager } = await import('../managers/conversation.js');
    let convData = { messages: [] };
    try {
      convData = await conversationManager.loadConversation(sessionId);
    } catch (e) {
      console.warn(`[SessionStart] Failed to load conversation: ${e.message}`);
    }
    
    // Detect task type
    const detectedTask = conversationManager.detectTaskType(convData);
    
    // Load global rules
    const rules = await ruleManager.loadGlobalRules();
    
    // Update context (READ-ONLY: doesn't modify workspace)
    context.task = detectedTask;
    context.rules = rules;
    context.initialized = true;
    
    // Persist context
    await sessionContextPersistence.save(sessionId, context);
    
    return {
      status: 'SESSION_READY',
      workspace: context.workspace,
      session_id: sessionId,
      active_task: context.task || 'none',
      rules_loaded: rules.length,
      details: {
        message: '环境已就绪，可以开始执行工具调用。',
        conversation_snippet: conversationManager.extractConversationSummary(convData).userMessages.slice(0, 3),
        global_rules_loaded: true
      }
    };
  }

  /**
   * workspace_info 处理 - Bootstrap 层
   */
  static async handleWorkspaceInfo(args, sessionId) {
    const workspace = workspaceManager.getWorkspaceForSession(sessionId);
    const isSet = workspace !== null && workspace !== process.cwd();
    
    let info = `当前 Workspace: ${workspace} ${isSet ? '(本会话已设置)' : '(⚠️  未设置，当前为进程 cwd)'}\n`;
    
    try {
      const sizeOutput = await this.execSync(`du -sh . 2>/dev/null | cut -f1`, { encoding: 'utf8', cwd: workspace });
      info += `目录大小: ${sizeOutput.trim()}\n`;
    } catch {}
    
    info += `\n最近使用历史:\n`;
    try {
      const statePath = this.getStatePath();
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const globalLast = state.globalLast;
        if (globalLast) {
          info += `  1. ${globalLast}${globalLast === workspace ? ' ← 当前' : ''}\n`;
        }
        
        if (sessionId && state.sessions && state.sessions[sessionId]) {
          const sessionWs = state.sessions[sessionId].workspace;
          info += `  2. ${sessionWs}${sessionWs === workspace ? ' ← 当前（本会话）' : ''}\n`;
        }
      }
    } catch {}
    
    return info;
  }

  /**
   * load_global_rules 处理 - Bootstrap 层
   */
  static async handleLoadGlobalRules(args, sessionId) {
    const rules = await ruleManager.loadGlobalRules();
    
    return {
      status: 'RULES_LOADED',
      rules_count: rules.length,
      rules: rules.map(r => ({ name: r.name, path: r.path }))
    };
  }

  /**
   * workspace_clear 处理 - Bootstrap 层
   */
  static async handleWorkspaceClear(args, sessionId) {
    workspaceManager.clearSessionWorkspace(sessionId);
    
    const context = sessionContextManager.getOrCreateContext(sessionId);
    context.workspace = null;
    
    return {
      status: 'WORKSPACE_CLEARED',
      message: '✅ 已清除 workspace 设置，当前使用进程 cwd'
    };
  }

  /**
   * Build complete context object
   */
  static buildFullContext(sessionId, context) {
    return {
      sessionId,
      workspace: context.workspace || null,
      task: context.task || null,
      rules: context.rules || [],
      buffers: context.buffers || {},
      gitState: context.gitState || {}
    };
  }

  /**
   * 更新 session context
   */
  static async updateContext(sessionId, updates) {
    const context = sessionContextManager.getOrCreateContext(sessionId);
    
    if (updates.workspace !== undefined) context.workspace = updates.workspace;
    if (updates.task !== undefined) context.task = updates.task;
    if (updates.rules !== undefined) context.rules = updates.rules;
    if (updates.buffers !== undefined) context.buffers = updates.buffers;
    if (updates.gitState !== undefined) context.gitState = updates.gitState;
    
    await sessionContextPersistence.save(sessionId, context);
  }

  /**
   * Get state file path
   */
  static getStatePath() {
    return path.join(os.homedir(), '.lmstudio', '.internal', 'mcp_runtime_state.json');
  }
}

export default SessionMiddleware;
