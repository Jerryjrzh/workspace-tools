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
      if (i <= index) {
        throw new Error('next() called multiple times in a single stage');
      }
      index = i;

      if (i === this.stages.length) {
        return;
      }

      const stage = this.stages[i];

      try {
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

function createContext(initialData = {}) {
  return {
    sessionId: initialData.sessionId || null,
    taskId: initialData.taskId || null,
    workspace: initialData.workspace || null,
    session: initialData.session || {},
    conversation: initialData.conversation || null,
    task: initialData.task || null,
    rules: initialData.rules || [],
    skills: initialData.skills || [],
    memory: initialData.memory || { entries: [] },
    retrievedMemory: initialData.retrievedMemory || [],
    promptContext: initialData.promptContext || null,
    executionPlan: initialData.executionPlan || null,
    executionHints: initialData.executionHints || null,
    toolRequest: initialData.toolRequest || { name: '', args: {} },
    state: initialData.state || {},
    result: initialData.result ?? null,
    providerRegistry: initialData.providerRegistry || null,
    memoryManager: initialData.memoryManager || null,
    timestamp: Date.now(),
    error: initialData.error || null
  };
}

export { AgentRuntime, createContext };
