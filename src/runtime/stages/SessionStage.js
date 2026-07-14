import fs from 'fs';
import path from 'path';
import os from 'os';

function loadConversation(convId) {
  const convDir = path.join(os.homedir(), '.lmstudio', 'conversations');
  const filePath = path.join(convDir, `${convId}.conversation.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function detectTaskType(convData) {
  const messages = convData?.messages || [];
  const text = messages.map((m) => m.content?.text || '').join(' ').toLowerCase();
  if (/编码|coding|实现|implement|开发|develop|修复|fix|bug|错误|error|优化|optimize|重构|refactor/i.test(text)) {
    return 'coding';
  }
  if (/调试|debug|问题|problem|异常|exception|崩溃|crash|日志|log/i.test(text)) {
    return 'debug';
  }
  return 'general';
}

function buildSummary(conversation) {
  const messages = conversation?.messages || [];
  const userMessages = messages
    .filter((msg) => msg.role === 'user')
    .slice(-3)
    .map((msg) => msg.content?.text || '')
    .filter(Boolean);

  return {
    kind: 'conversation',
    title: conversation?.name || 'Unknown',
    messageCount: messages.length,
    recentUserMessages: userMessages,
    summary: userMessages.length > 0 ? userMessages.join(' | ') : 'No user messages'
  };
}

function buildSnapshot(conversation, workspace, task) {
  return {
    kind: 'conversation',
    workspace,
    task,
    turnCount: (conversation?.messages || []).length,
    lastUpdated: new Date().toISOString(),
    preview: (conversation?.messages || []).slice(-2)
  };
}

function persistSessionState(sessionId, state) {
  const sessionDir = path.join(os.homedir(), '.lmstudio', 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const statePath = path.join(sessionDir, `${sessionId}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  return statePath;
}

export async function SessionStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const convData = loadConversation(sessionId);
  const conversation = convData || {
    name: 'Unknown',
    messages: []
  };

  const task = detectTaskType(conversation);
  const summary = buildSummary(conversation);
  const snapshot = buildSnapshot(conversation, ctx.workspace || null, task);
  const state = {
    sessionId,
    workspace: ctx.workspace || null,
    task,
    summary,
    snapshot,
    initialized: true,
    conversation,
    updatedAt: new Date().toISOString()
  };

  const statePath = persistSessionState(sessionId, state);

  ctx.session = {
    id: sessionId,
    workspace: ctx.workspace || null,
    task,
    initialized: true,
    conversation,
    summary,
    snapshot,
    statePath,
    persisted: true
  };
  ctx.task = ctx.session.task;
  ctx.conversation = conversation;
  ctx.sessionState = state;

  return next();
}
