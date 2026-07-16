import { sessionPersistenceProvider } from '../providers/SessionPersistenceProvider.js';

export async function SessionRecoveryStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const persistence = ctx.providerRegistry?.get?.('persistence') || sessionPersistenceProvider;
  const savedState = persistence.loadSessionState?.(sessionId) || null;

  if (!savedState) {
    return next();
  }

  if (!ctx.workspace && savedState.workspace) {
    ctx.workspace = savedState.workspace;
  }

  if (!ctx.task && savedState.task) {
    ctx.task = savedState.task;
  }

  if (!ctx.conversation && savedState.conversation) {
    ctx.conversation = savedState.conversation;
  }

  ctx.session = ctx.session || {};
  ctx.session.recovered = true;
  ctx.session.workspace = ctx.workspace || ctx.session.workspace || null;
  ctx.session.task = ctx.task || ctx.session.task || null;
  ctx.state = ctx.state || {};
  ctx.state.sessionRecovery = {
    workspace: Boolean(savedState.workspace),
    task: Boolean(savedState.task),
    conversation: Boolean(savedState.conversation)
  };

  return next();
}

export default SessionRecoveryStage;
