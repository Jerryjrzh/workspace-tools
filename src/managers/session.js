// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { conversationManager } from './conversation.js';
import { sessionContextManager } from './sessionContext.js';
import { SessionResolver } from './sessionResolver.js';
import { SessionMiddleware } from '../middleware/sessionMiddleware.js';

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
  const inferredWorkspace = context.workspace || null; // Workspace is set by middleware or session_start
  const detectedTask = conversationManager.detectTaskType(convData);

  // 5. Update unified context
  if (args.path) {
    context.workspace = args.path;
  }
  context.task = detectedTask;
  context.initialized = true;

  // 6. Persist context
  await SessionMiddleware.updateContext(sessionId, {
    workspace: context.workspace,
    task: context.task,
    initialized: context.initialized
  });

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