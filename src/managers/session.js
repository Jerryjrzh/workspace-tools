// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { workspaceManager } from './workspace.js';
import { conversationManager } from './conversation.js';
import { ruleManager } from './rules.js';
import { sessionContextManager } from './sessionContext.js';
import { SessionResolver } from './sessionResolver.js';

/**
 * Load workspace log file (local helper, also defined in server.js)
 */
function loadWorkspaceLog(ws) {
  try {
    const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (e) {}
  return { sessions: [] };
}

/**
 * Get workspace with fallback chain
 * Priority:
 * 1. Extracted from conversation (Tool call)
 * 2. Current global default from workspaceManager
 * 3. Last path from workspace log
 * 4. null
 */
async function getWorkspaceFallback() {
  // Fallback 1: Current global default
  const currentGlobal = workspaceManager.getWorkspace?.();
  if (currentGlobal) return currentGlobal;

  // Fallback 2: Last path from workspace log
  try {
    const logPath = path.join(process.cwd(), '.lmstudio-workspace.json');
    if (fs.existsSync(logPath)) {
      const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      const lastSession = log.sessions?.slice(-1)[0];
      if (lastSession?.path) return lastSession.path;
    }
  } catch (e) {
    // Continue to next fallback
  }

  return null;
}

export async function handleSessionStart(args, passedConvId) {
  const mode = args.mode || 'fast'; // Implement fast/deep split mode

  // 1. Resolve session ID using SessionResolver (no more 'default'污染)
  const sessionId = await SessionResolver.resolve(passedConvId);

  // 2. Get or create unified context
  const context = sessionContextManager.getOrCreateContext(sessionId);

  // 3. Load conversation data
  let convData = { messages: [] };
  try {
    convData = await conversationManager.loadConversation(sessionId);
  } catch (e) {
    console.warn(`[Session ${sessionId}] 会话加载失败，按空会话处理`);
  }

  // 4. Delegate parsing to appropriate managers
  const inferredWorkspace = conversationManager.extractWorkspace(convData) || await getWorkspaceFallback();
  const detectedTask = conversationManager.detectTaskType(convData);

  // 5. Update unified context
  context.workspace = inferredWorkspace;
  context.task = detectedTask;
  context.initialized = true;

  // 6. Bind workspace and init status
  if (context.workspace) {
    workspaceManager.setSessionWorkspace(sessionId, context.workspace);
  }
  workspaceManager.setSessionInitStatus(sessionId, true, context.task);

  // 7. Return standardized state
  const currentWs = context.workspace || "⚠️ 未设置";
  
  try {
    const wsLog = loadWorkspaceLog(currentWs);
    const lastWsSession = wsLog.sessions?.slice(-1)[0];

    return {
      status: "READY",
      workspace: currentWs,
      session_id: sessionId,
      active_task: context.task || "none",
      details: {
        message: "环境已就绪，可以开始执行工具调用。",
        mode: mode,
        last_archived_session: lastWsSession ? {
          date: lastWsSession.date,
          summary: lastWsSession.summary,
          context: lastWsSession.context
        } : null,
        conversation_snippet: conversationManager.extractConversationSummary(convData).userMessages.slice(0, 3),
        global_rules_loaded: true
      }
    };
  } catch (error) {
    return {
      status: "READY",
      workspace: currentWs,
      session_id: sessionId,
      active_task: context.task || "none",
      details: {
        message: "环境已就绪，可以开始执行工具调用。",
        mode: mode,
        error: error.message
      }
    };
  }
}
