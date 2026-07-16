// src/runtime/AgentRuntime.js
import { EventEmitter } from 'events';

/**
 * AgentRuntime - Core engine for V2.1
 * - Onion model pipeline (middleware/stages)
 * - EventEmitter for side effects (logging, backup, git, etc.)
 * - Single source of truth: RuntimeContext
 */
class AgentRuntime extends EventEmitter {
  constructor() {
    super();
    this.stages = [];
  }

  /**
   * Register a stage (middleware)
   * @param {Function} stage - async function(ctx, next) {}
   * @returns {AgentRuntime} - for chainable API
   */
  use(stage) {
    this.stages.push(stage);
    return this;
  }

  /**
   * Execute the pipeline with initial data
   * @param {Object} initialData - Initial context data
   * @returns {Promise<Object>} - Final context with result
   */
  async execute(initialData) {
    const ctx = createContext(initialData);
    this.emit('runtime:start', ctx);

    let index = -1;
    const dispatch = async (i) => {
      // Prevent next() called multiple times in same stage
      if (i <= index) {
        throw new Error('next() called multiple times in a single stage');
      }
      index = i;

      // All stages completed
      if (i === this.stages.length) {
        return;
      }

      const stage = this.stages[i];

      try {
        // Onion model: stage receives ctx and next()
        await stage(ctx, () => dispatch(i + 1));
      } catch (error) {
        this.emit('runtime:error', { error, stageIndex: i, ctx });
        throw error;
      }
    };

    await dispatch(0);
    this.emit('runtime:end', ctx);
    return ctx;
  }
}

/**
 * RuntimeContext factory - Plain Object, Single Source of Truth
 * All stages and tools only read/write this object
 */
function createContext(initialData = {}) {
  return {
    // 1. Basic metadata
    sessionId: initialData.sessionId || null,
    taskId: initialData.taskId || null,

    // 2. Core state (Single Source of Truth)
    workspace: initialData.workspace || null,
    session: initialData.session || {},
    conversation: initialData.conversation || null,
    task: initialData.task || null,
    rules: initialData.rules || [],
    skills: initialData.skills || [],
    memory: initialData.memory || { entries: [] },
    retrievedMemory: initialData.retrievedMemory || [],

    // 3. Execution payload
    toolRequest: initialData.toolRequest || { name: '', args: {} },

    // 4. Runtime buffer and state
    state: initialData.state || {},
    result: initialData.result ?? null,

    // 5. Injectable providers and managers
    providerRegistry: initialData.providerRegistry || null,
    memoryManager: initialData.memoryManager || null,

    // 6. Metadata
    timestamp: Date.now(),
    error: initialData.error || null
  };
}

export { AgentRuntime, createContext };
