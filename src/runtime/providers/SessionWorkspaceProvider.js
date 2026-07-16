import { workspaceManager } from '../../managers/workspace.js';

export class SessionWorkspaceProvider {
  constructor(workspaceProviderInstance = workspaceManager) {
    this.workspaceProvider = workspaceProviderInstance;
  }

  resolve(sessionId) {
    if (!sessionId) {
      return null;
    }

    return this.workspaceProvider?.getWorkspaceForSession?.(sessionId) || null;
  }

  set(sessionId, workspacePath) {
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    return this.workspaceProvider?.setSessionWorkspace?.(sessionId, workspacePath) || null;
  }

  clear(sessionId) {
    if (!sessionId) {
      return null;
    }

    return this.workspaceProvider?.clearSessionWorkspace?.(sessionId) || null;
  }
}

export const sessionWorkspaceProvider = new SessionWorkspaceProvider();
export default SessionWorkspaceProvider;
