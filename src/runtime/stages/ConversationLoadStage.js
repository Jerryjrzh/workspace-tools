import { conversationProvider } from '../providers/ConversationProvider.js';
import { normalizeConversation } from '../conversationNormalizer.js';

export async function ConversationLoadStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const rawConversation = conversationProvider.load(sessionId);
  // 归一化 LM Studio 原生格式 → 标准 {role, content:{text}}
  const conversation = normalizeConversation(rawConversation);

  ctx.conversation = conversation;
  ctx.session = ctx.session || {};
  ctx.session.conversation = conversation;
  ctx.session.id = sessionId;
  ctx.session.workspace = ctx.workspace || ctx.session.workspace || null;

  return next();
}

export default ConversationLoadStage;
