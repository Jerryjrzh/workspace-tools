import { conversationProvider } from '../providers/ConversationProvider.js';

export async function ConversationLoadStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const conversation = conversationProvider.load(sessionId) || {
    name: 'Unknown',
    messages: []
  };

  ctx.conversation = conversation;
  ctx.session = ctx.session || {};
  ctx.session.conversation = conversation;
  ctx.session.id = sessionId;
  ctx.session.workspace = ctx.workspace || ctx.session.workspace || null;

  return next();
}

export default ConversationLoadStage;
