import { workspaceManager } from '../../managers/workspace.js';
import { conversationProvider } from './ConversationProvider.js';

export class RuntimeContextProvider {
  constructor(conversationProviderInstance = conversationProvider, workspaceProviderInstance = workspaceManager) {
    this.conversationProvider = conversationProviderInstance;
    this.workspaceProvider = workspaceProviderInstance;
  }

  resolve(sessionId, fallbackWorkspace = null) {
    const conversation = sessionId ? this.conversationProvider?.load?.(sessionId) || null : null;
    const workspace = fallbackWorkspace || this.workspaceProvider?.getWorkspaceForSession?.(sessionId) || null;

    return {
      conversation,
      workspace
    };
  }
}

export const runtimeContextProvider = new RuntimeContextProvider();
