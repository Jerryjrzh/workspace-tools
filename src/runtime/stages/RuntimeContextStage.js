import { runtimeContextProvider } from '../providers/RuntimeContextProvider.js';
import { conversationProvider } from '../providers/ConversationProvider.js';
import { workspaceManager } from '../../managers/workspace.js';

export async function RuntimeContextStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  const fallbackWorkspace = ctx.workspace || null;

  const provider = new (await import('../providers/RuntimeContextProvider.js')).RuntimeContextProvider(
    conversationProvider,
    workspaceManager
  );

  const resolved = provider.resolve(sessionId, fallbackWorkspace);

  ctx.conversation = resolved.conversation || ctx.conversation || null;
  ctx.workspace = resolved.workspace || ctx.workspace || null;
  ctx.session = ctx.session || {};
  ctx.session.workspace = ctx.workspace;
  return next();
}
