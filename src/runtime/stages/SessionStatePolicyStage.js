import { sessionStateProvider } from '../providers/SessionStateProvider.js';

export async function SessionStatePolicyStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const state = {
    sessionId,
    workspace: ctx.workspace || null,
    task: ctx.task || null,
    summary: ctx.session?.summary || null,
    snapshot: ctx.session?.snapshot || null,
    conversation: ctx.conversation || null,
    initialized: true,
    updatedAt: new Date().toISOString()
  };

  const statePath = sessionStateProvider.save(sessionId, state);

  ctx.session = ctx.session || {};
  ctx.session.persisted = true;
  ctx.session.statePath = statePath;
  ctx.sessionState = state;
  return next();
}
