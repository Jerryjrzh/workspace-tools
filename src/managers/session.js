// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { conversationManager } from './conversation.js';
import { sessionContextManager } from './sessionContext.js';
import { SessionResolver } from './sessionResolver.js';
import { workspaceManager } from './workspace.js';
import { ruleManager } from './rules.js';

function loadWorkspaceLog(ws) {
  try {
    const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
    if (fs.existsSync(logPath)) {
      const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      // Normalize `sessions` to an array of archived session records.
      // context_anchor writes `.lmstudio-workspace.json` with sessions as an object
      // keyed by sessionId (each holding { anchor }), while this code expects the
      // legacy array format [{ date, summary, ... }]. Handle both shapes so a stale
      // or foreign file can never crash session_start.
      if (!parsed || typeof parsed !== 'object') {
        return { sessions: [] };
      }
      let sessions = parsed.sessions;
      if (Array.isArray(sessions)) {
        return { ...parsed, sessions };
      }
      if (sessions && typeof sessions === 'object') {
        // Object format → collect entries that look like archived session records.
        const archiveEntries = Object.values(sessions).filter(
          (e) => e && typeof e === 'object' && ('date' in e || 'summary' in e)
        );
        return { ...parsed, sessions: archiveEntries };
      }
      return { ...parsed, sessions: [] };
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
  // Resume the previous session's workspace when this is a fresh conversation. Priority:
  //   1. in-memory context (this server process)
  //   2. per-session persistence
  //   3. Workspace Compass — most recent trustworthy workspace from history
  //   4. legacy globalLast / process.cwd() as final fallback
  //
  // The compass rejects MCP install dirs and transient test paths, so a stale entry can no
  // longer shadow the correct project path.
  const workspaceFromContext =
    (context.workspace) ? context.workspace :
    workspaceManager.getWorkspaceForSession(sessionId) ||
    workspaceManager.getCompassWorkspace() ||
    process.cwd();
  const normalizedWorkspace = workspaceFromContext ? path.resolve(workspaceFromContext) : process.cwd();
  const rules = await ruleManager.loadGlobalRules();

  context.workspace = normalizedWorkspace;
  workspaceManager.setSessionWorkspace(sessionId, normalizedWorkspace);
  context.task = detectedTask;
  context.rules = rules;
  context.initialized = true;

  // Runtime pipeline reads session state from the in-memory SessionContext and per-session
  // workspace persistence (workspaceManager). Do not write middleware-specific files here —
  // that would create a second, divergent source of truth for the same session.
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