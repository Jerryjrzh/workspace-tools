// src/runtime/observability/ExecutionRecorder.js

/**
 * ExecutionRecorder - records the complete execution chain for replay/debug.
 *
 * Chain: Prompt → Context → Planner → Tool → Artifact → Response.
 *
 * This is the data source for true Replay (not just tool replay) — it captures
 * the full input/output at each stage so a later run can be reconstructed.
 */
export class ExecutionRecorder {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    // ordered chain per traceId
    this._chainsByTrace = new Map();
  }

  /**
   * Record one execution step in the chain.
   * @param {Object} opts - { traceId, stage, input?, output?, meta? }
   */
  record(opts) {
    const traceId = opts.traceId || 'default';
    const entry = {
      id: `${traceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      traceId,
      stage: opts.stage, // prompt | context | planner | tool | artifact | response
      input: opts.input ?? null,
      output: opts.output ?? null,
      meta: { ...(opts.meta || {}) },
      timestamp: Date.now()
    };

    const chain = this._chainsByTrace.get(traceId) || [];
    chain.push(entry);
    this._chainsByTrace.set(traceId, chain);

    if (this.eventBus?.executionRecorded) {
      this.eventBus.executionRecorded({ traceId, entry });
    }

    return entry;
  }

  /** Get the full execution chain for a trace id. */
  getChain(traceId = 'default') {
    return this._chainsByTrace.get(traceId) || [];
  }

  /**
   * Convenience: record an entire request lifecycle from a RuntimeContext.
   * @param {Object} ctx - runtime context (has toolRequest, executionPlan, result)
   */
  recordFromContext(ctx, opts = {}) {
    const traceId = opts.traceId || ctx.task?.id || ctx.sessionId || 'default';

    // Prompt
    this.record({
      traceId,
      stage: 'prompt',
      input: ctx.conversation?.messages?.slice(-1)[0] ?? null,
      meta: { sessionId: ctx.sessionId }
    });

    // Context (assembled runtime context)
    this.record({
      traceId,
      stage: 'context',
      output: {
        task: ctx.task ? String(ctx.task) : null,
        rulesCount: ctx.rules?.length || 0,
        memoryEntries: ctx.memory?.entries?.length || 0
      }
    });

    // Planner
    this.record({
      traceId,
      stage: 'planner',
      output: ctx.executionPlan ?? ctx.planner ?? null
    });

    // Tool
    if (ctx.toolRequest?.name) {
      this.record({
        traceId,
        stage: 'tool',
        input: { name: ctx.toolRequest.name, args: ctx.toolRequest.args },
        output: ctx.result ?? null
      });
    }

    // Artifact references
    const artifacts = ctx.task?.artifacts || {};
    if (Object.keys(artifacts).length > 0) {
      this.record({
        traceId,
        stage: 'artifact',
        input: artifacts
      });
    }

    // Response / final result
    this.record({
      traceId,
      stage: 'response',
      output: ctx.result ?? null,
      meta: { ok: ctx.validation?.ok ?? true }
    });

    return this.getChain(traceId);
  }

  /** Reset the chain for a trace (for fresh replay). */
  reset(traceId = 'default') {
    this._chainsByTrace.set(traceId, []);
  }
}

export default ExecutionRecorder;
