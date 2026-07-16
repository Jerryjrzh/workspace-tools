import { RuntimeContextProvider } from '../providers/RuntimeContextProvider.js';
import { conversationProvider } from '../providers/ConversationProvider.js';
import { workspaceManager } from '../../managers/workspace.js';
import { sessionWorkspaceProvider } from '../providers/SessionWorkspaceProvider.js';

export async function RuntimeContextStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;

  const registry = ctx.providerRegistry || null;
  const conversationProviderInstance = registry?.get?.('conversation') || conversationProvider;
  const workspaceProviderInstance = registry?.get?.('workspace') || workspaceManager;

  const provider = new RuntimeContextProvider(
    conversationProviderInstance,
    workspaceProviderInstance
  );

  const resolved = provider.resolve(sessionId, null);
  const sessionWorkspace = sessionWorkspaceProvider.resolve(sessionId);

  ctx.conversation = resolved.conversation || ctx.conversation || null;
  ctx.workspace = sessionWorkspace || resolved.workspace || ctx.workspace || null;
  ctx.session = ctx.session || {};
  ctx.session.workspace = ctx.workspace;
  ctx.session.conversationId = sessionId;
  ctx.session.workspaceSource = sessionWorkspace ? 'session' : 'runtime';
  return next();
}
