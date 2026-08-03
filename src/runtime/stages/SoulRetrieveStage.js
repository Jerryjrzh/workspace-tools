// src/runtime/stages/SoulRetrieveStage.js
import { memoryManager } from '../../managers/memory.js';

function getRecentUserMessages(conversation, limit = 3) {
  const messages = conversation?.messages || [];
  return messages
    .filter((message) => message.role === 'user')
    .slice(-limit)
    .map((message) => message.content?.text || message.content || '')
    .filter(Boolean);
}

function buildRetrievalQuery(ctx) {
  const parts = [];

  if (ctx.task) {
    parts.push(String(ctx.task));
  }

  parts.push(...getRecentUserMessages(ctx.conversation, 3));

  if (ctx.toolRequest?.name) {
    parts.push(ctx.toolRequest.name);
  }

  if (ctx.toolRequest?.args) {
    parts.push(JSON.stringify(ctx.toolRequest.args));
  }

  return parts.filter(Boolean).join(' ');
}export async function SoulRetrieveStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    ctx.retrievedSoulMemory = [];
    return next();
  }

  const manager = ctx.memoryManager || memoryManager;
  const query = buildRetrievalQuery(ctx);
  const retrievedSoulMemory = manager.search(sessionId, query, {
    limit: manager.maxRetrieve,
    domain: 'soul'
  });

  ctx.retrievedSoulMemory = retrievedSoulMemory;
  ctx.state = ctx.state || {};
  ctx.state.soulRetrieve = {
    query,
    count: retrievedSoulMemory.length
  };
  ctx.session = ctx.session || {};
  ctx.session.retrievedSoulMemory = retrievedSoulMemory;
  return next();
}

export default SoulRetrieveStage;
