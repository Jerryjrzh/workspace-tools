// src/managers/autoBootstrap.js
import fs from 'fs';
import path from 'path';
import { conversationManager } from './conversation.js';
import { workspaceManager } from './workspace.js';

/**
 * Resolve a workspace for a session without requiring an explicit workspace_set/session_start.
 *
 * Priority:
 *   1. Persisted per-session workspace
 *   2. Workspace inferred from the conversation content (explicit path mentions)
 *   3. Global last-used workspace
 *   4. Directory of the requested absolute path (if args.path is absolute)
 *   5. process.cwd() as a final fallback — but never silently select the MCP install dir.
 *
 * @param {string} sessionId - Session / conversation ID
 * @param {Object} [args] - Tool arguments, may contain an absolute `path`
 * @returns {Promise<string|null>} - Resolved workspace path (persisted), or null if none found
 */
export async function autoResolveWorkspace(sessionId, args = {}) {
  let convData = { messages: [] };
  try {
    convData = await conversationManager.loadConversation(sessionId);
  } catch (e) {
    // Conversation unavailable — fall through to persisted/global state.
  }

  const persistedWorkspace = workspaceManager.getWorkspaceForSession(sessionId);
  const inferredWorkspace = conversationManager.detectWorkspace(convData, args.path);
  const globalWorkspace = workspaceManager.getWorkspace();
  // Workspace Compass: most recent trustworthy workspace from history (rejects MCP install
  // dirs and transient test paths).
  const compassWorkspace = workspaceManager.getCompassWorkspace();
  const candidates = [persistedWorkspace, inferredWorkspace, globalWorkspace, compassWorkspace]
    .filter((candidate) => candidate && fs.existsSync(candidate));

  if (candidates.length > 0) {
    return candidates[0];
  }

  // Never silently select the MCP installation directory merely because it is cwd.
  if (args.path && path.isAbsolute(args.path)) {
    const dir = path.dirname(args.path);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }

  return null;
}

/**
 * Persist a resolved workspace for the session so subsequent pipeline runs reuse it.
 *
 * @param {string} sessionId - Session / conversation ID
 * @param {string|null} workspacePath - Workspace path to persist (no-op if null)
 */
export function persistResolvedWorkspace(sessionId, workspacePath) {
  if (!workspacePath || !sessionId) {
    return;
  }
  try {
    workspaceManager.setSessionWorkspace(sessionId, workspacePath);
  } catch (e) {
    // Ignore persistence failures — the resolved path is still usable this call.
  }
}

export default { autoResolveWorkspace, persistResolvedWorkspace };
