import { sessionPersistenceProvider } from './SessionPersistenceProvider.js';

class ConversationProvider {
  constructor(provider = sessionPersistenceProvider) {
    this.provider = provider;
  }

  load(sessionId) {
    return this.provider.loadConversation(sessionId);
  }

  list() {
    return [];
  }
}

export const conversationProvider = new ConversationProvider();
export default ConversationProvider;
