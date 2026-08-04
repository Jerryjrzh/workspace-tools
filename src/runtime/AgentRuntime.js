// src/runtime/AgentRuntime.js
import { EventEmitter } from 'events';
import { eventBus, DOMAIN_EVENTS } from './EventBus.js';

/**
 * RuntimeContext - The single source of truth flowing through the stage pipeline.
 *
 * This is the formal Context Contract (see docs/CONTEXT_CONTRACT.md). All stages,
 * tools, and planners depend on this exact shape. New fields should be added here
 * in one place rather than scattered across a dozen files.
 */
export class RuntimeContext {
  constructor(initialData = {}) {
    const toolRequest = initialData.toolRequest || {};
    const sessionId =
      initialData.sessionId ||
      toolRequest.conversationId ||
      null;

    this.sessionId = sessionId;
    this.taskId = initialData.taskId || null;
    this.workspace = initialData.workspace || null;
    this.session = {
      ...(initialData.session || {}),
      sessionId,
      conversationId: toolRequest.conversationId || initialData.conversationId || sessionId
    };
    this.conversation = initialData.conversation || null;
    this.task = initialData.task || null;
    this.rules = initialData.rules || [];
    this.skills = initialData.skills || [];
    this.memory = initialData.memory || { entries: [] };
    this.retrievedMemory = initialData.retrievedMemory || [];
    this.promptContext = initialData.promptContext || null;
    this.executionPlan = initialData.executionPlan || null;
    this.executionHints = initialData.executionHints || null;
    this.toolRequest = {
      name: toolRequest.name || '',
      args: toolRequest.args || {},
      conversationId: toolRequest.conversationId
    };
    this.state = initialData.state || {};
    this.result = initialData.result ?? null;
    this.providerRegistry = initialData.providerRegistry || null;
    this.memoryManager = initialData.memoryManager || null;
    this.capabilities = initialData.capabilities || null;
    this.planner = initialData.planner || null;
    this.runtimeState = initialData.runtimeState || {};
    this.timestamp = Date.now();
    this.error = initialData.error || null;

    // Lifecycle bookkeeping
    this.lifecycle = {
      initialized: false,
      startedAt: null,
      endedAt: null,
      persisted: false,
      cleanedUp: false
    };
  }

  /** Convenience factory used by AgentRuntime.execute */
  static create(initialData) {
    return new RuntimeContext(initialData);
  }
}

/**
 * AgentRuntime - Core engine for V2.1
 *
 * Lifecycle contract (see docs/CONTEXT_CONTRACT.md):
 *   initialize() → beforeRequest() → buildContext() → execute()
 *   → afterExecute() → persist() → cleanup()
 *
 * Each phase is overridable so Streaming / Multi-Agent / Background Task can extend.
 */
class AgentRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.stages = [];
    // Lifecycle hooks (default no-ops, override per runtime flavor)
    this.hooks = options.hooks || {};
    // Domain event bus for Observers (Memory/Telemetry/Log/Plugin/UI/Streaming)
    this.eventBus = options.eventBus || eventBus;
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

  // ─────────────────────────── Lifecycle Contract ───────────────────────────

  /**
   * Phase 1: initialize() — allocate resources, wire providers.
   * @param {Object} initialData
   */
  async initialize(initialData) {
    const ctx = RuntimeContext.create(initialData);
    if (this.hooks.initialize) {
      await this.hooks.initialize(ctx);
    }
    return ctx;
  }

  /**
   * Phase 2: beforeRequest() — pre-request side effects / telemetry.
   */
  async beforeRequest(ctx) {
    if (this.hooks.beforeRequest) {
      await this.hooks.beforeRequest(ctx);
    }
    return ctx;
  }

  /**
   * Phase 3: buildContext() — assemble the full RuntimeContext from initial data.
   */
  async buildContext(initialData) {
    const ctx = RuntimeContext.create(initialData);
    if (this.hooks.buildContext) {
      await this.hooks.buildContext(ctx);
    }
    return ctx;
  }

  /**
   * Phase 4: execute() — run the stage pipeline.
   */
  async execute(initialData) {
    // Full lifecycle orchestration
    const ctx = await this.initialize(initialData);
    await this.beforeRequest(ctx);

    this.emit('runtime:start', ctx);
    ctx.lifecycle.startedAt = Date.now();
    this.eventBus.contextBuilt({ sessionId: ctx.sessionId, workspace: ctx.workspace });
    if (ctx.sessionId) {
      this.eventBus.sessionStarted({ sessionId: ctx.sessionId });
    }

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
        ctx.error = error;
        this.emit('runtime:error', { error, stageIndex: i, ctx });
        throw error;
      }
    };

    await dispatch(0);

    ctx.lifecycle.endedAt = Date.now();
    this.emit('runtime:end', ctx);

    // Post-execution phases
    await this.afterExecute(ctx);
    await this.persist(ctx);
    await this.cleanup(ctx);

    return ctx;
  }

  /**
   * Phase 5: afterExecute() — post-pipeline side effects (logging, metrics).
   */
  async afterExecute(ctx) {
    if (this.hooks.afterExecute) {
      await this.hooks.afterExecute(ctx);
    }
    return ctx;
  }

  /**
   * Phase 6: persist() — flush state to durable storage.
   */
  async persist(ctx) {
    if (this.hooks.persist) {
      await this.hooks.persist(ctx);
    }
    ctx.lifecycle.persisted = true;
    return ctx;
  }

  /**
   * Phase 7: cleanup() — release resources, close watchers.
   */
  async cleanup(ctx) {
    if (this.hooks.cleanup) {
      await this.hooks.cleanup(ctx);
    }
    ctx.lifecycle.cleanedUp = true;
    return ctx;
  }

  /**
   * Run only the stage pipeline on an already-built context (used by
   * Streaming / Multi-Agent where lifecycle is managed externally).
   */
  async runStages(initialData) {
    const ctx = await this.buildContext(initialData);
    let index = -1;
    const dispatch = async (i) => {
      if (i <= index) throw new Error('next() called multiple times in a single stage');
      index = i;
      if (i === this.stages.length) return;
      const stage = this.stages[i];
      try {
        await stage(ctx, () => dispatch(i + 1));
      } catch (error) {
        ctx.error = error;
        throw error;
      }
    };
    await dispatch(0);
    return ctx;
  }
}

/**
 * Backwards-compatible factory for the legacy createContext() helper.
 */
function createContext(initialData = {}) {
  return RuntimeContext.create(initialData);
}

export { AgentRuntime, createContext };
