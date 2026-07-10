// src/managers/sessionResolver.js
import { conversationManager } from './conversation.js';

/**
 * SessionResolver class
 * 
 * Resolves the correct session ID in a single, authoritative place.
 * This eliminates the "default" placeholder ID problem.
 */
class SessionResolver {
  constructor() {
    // Private constructor to enforce static usage
  }

  /**
   * Resolve the session ID from an optional passed ID
   * 
   * Priority:
   1. Passed ID (if valid and not 'default')
   2. Latest conversation ID from conversation manager
   3. Generate a new UUID for fresh sessions
   * 
   * @param {string|null} passedId - The optional passed session ID
   * @returns {string} The resolved session ID
   */
  static async resolve(passedId) {
    // Fallback 1: Use passed ID if it's valid and not 'default'
    if (passedId && passedId !== 'default') {
      return passedId;
    }

    // Fallback 2: Try to get the latest conversation
    try {
      const latestConv = await conversationManager.getLatestConversation();
      if (latestConv && latestConv.name) {
        // Remove '.conversation.json' extension to get the session ID
        return latestConv.name.replace('.conversation.json', '');
      }
    } catch (e) {
      // If conversation manager fails, continue to next fallback
      console.warn('[SessionResolver] Failed to get latest conversation:', e.message);
    }

    // Fallback 3: Generate a new UUID for fresh sessions
    // This ensures we never use 'default' as a session ID
    const crypto = await import('crypto');
    return crypto.randomUUID();
  }

  /**
   * Validate if an ID is acceptable (not 'default')
   */
  static isValidId(id) {
    return id && id !== 'default';
  }
}

export { SessionResolver };
