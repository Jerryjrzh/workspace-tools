import { sessionPersistenceProvider } from './SessionPersistenceProvider.js';

export class SessionStateProvider {
  constructor(provider = sessionPersistenceProvider) {
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
