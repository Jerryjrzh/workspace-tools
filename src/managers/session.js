// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { conversationManager } from './conversation.js';
import { sessionContextManager } from './sessionContext.js';
import { SessionResolver } from './sessionResolver.js';
import { SessionMiddleware } from '../middleware/sessionMiddleware.js';
import { workspaceManager } from './workspace.js';
import { ruleManager } from './rules.js';

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
  const mode = args.mode || 'fast';
  const sessionId = await SessionResolver.resolve(passedConvId);
  const context = sessionContextManager.getOrCreateContext(sessionId);

  let convData = { messages: [] };
  try {
    convData = await conversationManager.loadConversation(sessionId);
  } catch (e) {
    console.warn(`[Session ${sessionId}] 会话加载失败，按空会话处理`);
  }

  const detectedTask = conversationManager.detectTaskType(convData);
  const workspaceFromContext = context.workspace || workspaceManager.getWorkspaceForSession(sessionId) || workspaceManager.getWorkspace() || process.cwd();
  const rules = await ruleManager.loadGlobalRules();

  context.workspace = workspaceFromContext;
  context.task = detectedTask;
  context.rules = rules;
  context.initialized = true;

  await SessionMiddleware.updateContext(sessionId, {
    workspace: context.workspace,
    task: context.task,
    rules: context.rules,
    initialized: context.initialized
  });

  const currentWs = context.workspace || '⚠️ 未设置';

  try {
    const wsLog = loadWorkspaceLog(currentWs);
    const lastWsSession = wsLog.sessions?.slice(-1)[0];

    return {
      status: 'SESSION_READY',
      workspace: currentWs,
      session_id: sessionId,
      active_task: context.task || 'none',
      rules_loaded: rules.length,
      details: {
        message: '环境已就绪，可以开始执行工具调用。',
        mode,
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
      status: 'SESSION_READY',
      workspace: currentWs,
      session_id: sessionId,
      active_task: context.task || 'none',
      rules_loaded: rules.length,
      details: {
        message: '环境已就绪，可以开始执行工具调用。',
        mode,
        error: error.message
      }
    };
  }
}