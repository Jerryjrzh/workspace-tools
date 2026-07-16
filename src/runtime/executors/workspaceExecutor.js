import path from 'path';
import fs from 'fs';
import { workspaceManager } from '../../managers/workspace.js';

export function resolveWorkspace(sessionId, fallback = null) {
  if (fallback) {
    return path.resolve(fallback);
  }
  return workspaceManager.getWorkspaceForSession(sessionId) || null;
}

export function setSessionWorkspace(sessionId, workspacePath) {
  return workspaceManager.setSessionWorkspace(sessionId, workspacePath);
}

export function clearSessionWorkspace(sessionId) {
  return workspaceManager.clearSessionWorkspace(sessionId);
}

export function getWorkspaceInfo(sessionId) {
  const workspace = resolveWorkspace(sessionId, null);
  if (!workspace) {
    return {
      workspace: null,
      isSet: false,
      exists: false,
      isDirectory: false
    };
  }

  return {
    workspace,
    isSet: workspace !== process.cwd(),
    exists: fs.existsSync(workspace),
    isDirectory: fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()
  };
}
