// src/runtime/providers/Provider.js
import { EventEmitter } from 'events';

/**
 * Provider - abstract base for all persistence backends.
 *
 * Per docs/CONTEXT_CONTRACT.md §5, every provider (Memory / Rule / Workspace /
 * Session) implements the unified interface:
 *   load(sessionId)       → read state
 *   save(sessionId, data) → write state
 *   watch(sessionId, cb)  → subscribe to changes (optional)
 *   dispose()             → release resources (optional)
 *
 * This enables switching between SQLite / Redis / Cloud / Workspace backends.
 */
export class Provider extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.watchers = new Map(); // sessionId -> Set<cb>
    this.disposed = false;
  }

  /**
   * Load state for a session. Subclasses must override.
   */
  async load(sessionId) {
    throw new Error(`[Provider] ${this.constructor.name}.load() not implemented`);
  }

  /**
   * Save state for a session. Subclasses must override.
   */
  async save(sessionId, data) {
    throw new Error(`[Provider] ${this.constructor.name}.save() not implemented`);
  }

  /**
   * Subscribe to changes for a session (optional).
   * @returns {Function} unsubscribe
   */
  watch(sessionId, cb) {
    if (!this.watchers.has(sessionId)) {
      this.watchers.set(sessionId, new Set());
    }
    const set = this.watchers.get(sessionId);
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) {
        this.watchers.delete(sessionId);
      }
    };
  }

  /**
   * Notify watchers of a change for a session.
   */
  notifyChange(sessionId, payload = {}) {
    const set = this.watchers.get(sessionId);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb({ sessionId, ...payload });
      } catch (_err) {
        // observer errors must not break the pipeline
      }
    }
  }

  /**
   * Release resources. Subclasses may override.
   */
  dispose() {
    this.disposed = true;
    this.watchers.clear();
    return Promise.resolve(true);
  }
}

export default Provider;
