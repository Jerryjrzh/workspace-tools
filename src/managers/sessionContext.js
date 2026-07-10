// src/managers/sessionContext.js
/**
 * SessionContext class
 * 
 * A unified context object that holds all session-related state.
 * This eliminates state scattering across multiple managers.
 */
class SessionContext {
  constructor(id) {
    this.id = id;
    this.workspace = null;
    this.task = null;
    this.initialized = false;
    this.conversationPath = null;
  }
}

/**
 * SessionContextManager
 * 
 * Manages a Map of sessionId -> SessionContext for all sessions.
 */
class SessionContextManager {
  constructor() {
    this.contexts = new Map();
  }

  /**
   * Get or create a context for a session ID
   */
  getOrCreateContext(sessionId) {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, new SessionContext(sessionId));
    }
    return this.contexts.get(sessionId);
  }

  /**
   * Get context for a session ID, returns null if not exists
   */
  getContext(sessionId) {
    return this.contexts.get(sessionId) || null;
  }

  /**
   * Check if a session context exists
   */
  hasContext(sessionId) {
    return this.contexts.has(sessionId);
  }

  /**
   * Delete a session context
   */
  deleteContext(sessionId) {
    this.contexts.delete(sessionId);
  }

  /**
   * Clear all contexts
   */
  clear() {
    this.contexts.clear();
  }
}

export const sessionContextManager = new SessionContextManager();
export { SessionContext };
