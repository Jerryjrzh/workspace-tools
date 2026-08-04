import { sessionPersistenceProvider } from './SessionPersistenceProvider.js';
import { Provider } from './Provider.js';

class ConversationProvider extends Provider {
  constructor(provider = sessionPersistenceProvider) {
    super();
    this.provider = provider;
  }

  load(sessionId) {
    return this.provider.loadConversation(sessionId);
  }

  save(sessionId, conversation) {
    return this.provider.saveConversation(sessionId, conversation);
  }

  list() {
    return [];
  }
}

export const conversationProvider = new ConversationProvider();
export default ConversationProvider;
