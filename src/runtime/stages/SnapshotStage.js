export async function SnapshotStage(ctx, next) {
  const conversation = ctx.conversation || { messages: [] };
  const snapshot = {
    kind: 'conversation',
    workspace: ctx.workspace || null,
    task: ctx.task || null,
    turnCount: (conversation.messages || []).length,
    lastUpdated: new Date().toISOString(),
    preview: (conversation.messages || []).slice(-2)
  };

  ctx.session = ctx.session || {};
  ctx.session.snapshot = snapshot;
  return next();
}
