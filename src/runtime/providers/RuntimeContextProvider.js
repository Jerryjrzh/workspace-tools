import { workspaceManager } from '../../managers/workspace.js';
import { conversationProvider } from './ConversationProvider.js';
import { normalizeConversation } from '../conversationNormalizer.js';

export class RuntimeContextProvider {
  constructor(conversationProviderInstance = conversationProvider, workspaceProviderInstance = workspaceManager) {
    this.conversationProvider = conversationProviderInstance;
    this.workspaceProvider = workspaceProviderInstance;
  }

  resolve(sessionId, fallbackWorkspace = null) {
    const rawConversation = sessionId ? this.conversationProvider?.load?.(sessionId) || null : null;
    // 归一化 LM Studio 原生 conversation → 标准 {role, content:{text}}，
    // 使 ContextBudgetStage / MemoryExtractStage 能读到真实消息文本。
    const conversation = rawConversation ? normalizeConversation(rawConversation) : null;
    const workspace = fallbackWorkspace || this.workspaceProvider?.getWorkspaceForSession?.(sessionId) || null;

    return {
      conversation,
      workspace
    };
  }
}

export const runtimeContextProvider = new RuntimeContextProvider();
