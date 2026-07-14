export async function SummaryStage(ctx, next) {
  const conversation = ctx.conversation || { messages: [] };
  const messages = conversation.messages || [];
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => message.content?.text || '')
    .filter(Boolean);

  const summary = {
    kind: 'conversation',
    title: conversation?.name || 'Unknown',
    messageCount: messages.length,
    recentUserMessages: userMessages,
    summary: userMessages.length > 0 ? userMessages.join(' | ') : 'No user messages'
  };

  ctx.session = ctx.session || {};
  ctx.session.summary = summary;
  ctx.session.summaryText = summary.summary;
  return next();
}
