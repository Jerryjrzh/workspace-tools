import { sessionPersistenceProvider } from './SessionPersistenceProvider.js';
import { Provider } from './Provider.js';

export class SessionStateProvider extends Provider {
  constructor(provider = sessionPersistenceProvider) {
    super();
    this.provider = provider;
  }

  save(sessionId, state) {
    return this.provider.saveSessionState(sessionId, state);
  }

  load(sessionId) {
    return this.provider.loadSessionState(sessionId);
  }
}

export const sessionStateProvider = new SessionStateProvider();
