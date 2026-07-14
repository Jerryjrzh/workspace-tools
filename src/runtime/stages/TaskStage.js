export async function TaskStage(ctx, next) {
  const conversation = ctx.conversation || { messages: [] };
  const messages = conversation.messages || [];
  const text = messages.map((message) => message.content?.text || '').join(' ').toLowerCase();

  if (/编码|coding|实现|implement|开发|develop|修复|fix|bug|错误|error|优化|optimize|重构|refactor/i.test(text)) {
    ctx.task = 'coding';
  } else if (/调试|debug|问题|problem|异常|exception|崩溃|crash|日志|log/i.test(text)) {
    ctx.task = 'debug';
  } else {
    ctx.task = 'general';
  }

  ctx.session = ctx.session || {};
  ctx.session.task = ctx.task;
  return next();
}
