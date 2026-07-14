// src/runtime/stages/WorkspaceStage.js
import { workspaceManager } from '../../managers/workspace.js';

/**
 * WorkspaceStage - ONLY resolve workspace path
 * 
 * This stage does ONE thing: resolve workspace and set ctx.workspace
 * 
 * DO NOT:
 * - restore/persist/verify/switch/permission checks
 * - All these go to GuardStage later
 * 
 * Uses Session ID to get workspace from workspaceManager
 */
export async function WorkspaceStage(ctx, next) {
  // Only process if we have a tool request with conversation_id
  if (!ctx.toolRequest || !ctx.toolRequest.conversationId) {
    await next();
    return;
  }

  const sessionId = ctx.toolRequest.conversationId;
  const sessionWorkspace = workspaceManager.getWorkspaceForSession(sessionId);

  // Preserve an explicit workspace from the initial context, otherwise use the session workspace.
  ctx.workspace = ctx.workspace || sessionWorkspace;

  await next();
}
