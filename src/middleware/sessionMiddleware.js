// src/middleware/sessionMiddleware.js
import { SessionResolver } from '../managers/sessionResolver.js';
import { sessionContextManager } from '../managers/sessionContext.js';
import { sessionContextPersistence } from '../managers/sessionContextPersistence.js';

/**
 * SessionMiddleware
 * 
 * Unified session context resolution middleware.
 * This eliminates the "Session ID exists in multiple sources" problem.
 * 
 * Single Source of Truth: SessionContext
 * - All tools consume context
 * - No tool generates context
 * - Session ID flows from LM Studio → Tool via middleware
 */
export class SessionMiddleware {
  /**
   * Resolve full session context for a tool call
   * @param {string} toolName - Name of the tool being executed
   * @param {Object} args - Tool arguments
   * @param {string} conversationId - Conversation ID from LM Studio
   * @returns {Promise<Object>} - Unified session context
   */
  static async resolveContext(toolName, args, conversationId) {
    // Step 1: Resolve session ID ( Single Source of Truth )
    const sessionId = await SessionResolver.resolve(conversationId);
    
    // Step 2: Get or create session context
    let context = sessionContextManager.getContext(sessionId);
    
    // Step 3: If context exists in memory, use it
    if (context) {
      return this.buildFullContext(sessionId, context);
    }
    
    // Step 4: Try to load from persistence (zero-latency recovery)
    try {
      context = await sessionContextPersistence.load(sessionId);
    } catch (e) {
      // If persistence fails, continue to next fallback
      console.warn(`[SessionMiddleware] Failed to load context from persistence for session ${sessionId}: ${e.message}`);
    }
    
    // Step 5: If loaded from persistence, update memory cache
    if (context) {
      sessionContextManager.getOrCreateContext(sessionId); // Create entry
      context = sessionContextManager.getContext(sessionId);
      return this.buildFullContext(sessionId, context);
    }
    
    // Step 6: For tools that don't need session context (like session_start itself),
    // return minimal context and let session_start populate it
    if (toolName === 'session_start') {
      return {
        sessionId,
        workspace: null,
        task: null,
        rules: [],
        buffers: {},
        gitState: {}
      };
    }
    
    // Step 7: If context doesn't exist and tool needs it, throw error
    throw new Error(`[SessionMiddleware] Session context not found for session ${sessionId}. Please call session_start first.`);
  }

  /**
   * Build complete context object from session context
   * @param {string} sessionId - Session ID
   * @param {Object} context - Session context
   * @returns {Object} - Full context with all fields
   */
  static buildFullContext(sessionId, context) {
    return {
      sessionId,
      workspace: context.workspace || null,
      task: context.task || null,
      rules: context.rules || [],
      buffers: context.buffers || {},
      gitState: context.gitState || {}
    };
  }

  /**
   * Update session context in memory and persistence
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Context updates
   * @returns {Promise<void>}
   */
  static async updateContext(sessionId, updates) {
    const context = sessionContextManager.getOrCreateContext(sessionId);
    
    // Apply updates
    if (updates.workspace !== undefined) context.workspace = updates.workspace;
    if (updates.task !== undefined) context.task = updates.task;
    if (updates.rules !== undefined) context.rules = updates.rules;
    if (updates.buffers !== undefined) context.buffers = updates.buffers;
    if (updates.gitState !== undefined) context.gitState = updates.gitState;
    
    // Persist to disk
    await sessionContextPersistence.save(sessionId, context);
  }
}

export default SessionMiddleware;
