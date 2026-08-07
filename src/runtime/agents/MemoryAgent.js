// src/runtime/agents/MemoryAgent.js
import { Agent } from './Agent.js';

/**
 * MemoryAgent - reads/writes memory entries for a session.
 *
 * Uses ctx.memoryManager (or falls back to the global memory manager) to store
 * extracted facts / preferences and retrieve relevant context. This is the
 * "Memory" advanced agent role in P5-B.
 */
export class MemoryAgent extends Agent {
  constructor(options = {}) {
    super({ role: 'memory', ...options });
  }

  async execute(ctx) {
    const manager = ctx.memoryManager || null;
    if (!manager) {
      return { ok: false, output: null, error: 'No memoryManager available' };
    }

    const sessionId =
      ctx.sessionId || ctx.toolRequest?.conversationId || 'default';
    const query = ctx.goal || ctx.task?.goal || '';
    const retrieved = manager.search(sessionId, query, {
      limit: manager.maxRetrieve
    });

    // Optionally persist a memory entry if provided in context
    let stored = null;
    if (ctx.memoryEntry) {
      stored = manager.remember(
        sessionId,
        ctx.memoryEntry.key || 'fact',
        typeof ctx.memoryEntry.value === 'string'
          ? ctx.memoryEntry.value
          : JSON.stringify(ctx.memoryEntry.value),
        { type: ctx.memoryEntry.type || 'fact' }
      );
    }

    return {
      ok: true,
      output: { retrieved, stored }
    };
  }
}

export default MemoryAgent;
