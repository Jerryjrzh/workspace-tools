// src/runtime/observability/ObservabilityManager.js
import { Trace } from './Trace.js';
import { Timeline } from './Timeline.js';
import { Metrics } from './Metrics.js';
import { ExecutionRecorder } from './ExecutionRecorder.js';

/**
 * ObservabilityManager - aggregates Trace / Timeline / Metrics /
 * ExecutionRecorder under one facade for Phase 6.
 *
 * All four collectors emit to the shared EventBus so Observers can subscribe
 * without coupling, and each also stores per-trace data for replay/debug.
 */
export class ObservabilityManager {
  constructor(options = {}) {
    const bus = options.eventBus || null;
    this.trace = new Trace({ eventBus: bus });
    this.timeline = new Timeline({ eventBus: bus });
    this.metrics = new Metrics({ eventBus: bus });
    this.recorder = new ExecutionRecorder({ eventBus: bus });
  }

  /**
   * Record a full request lifecycle from a RuntimeContext.
   * @param {Object} ctx - runtime context
   */
  recordRequest(ctx, opts = {}) {
    const traceId =
      opts.traceId || ctx.task?.id || ctx.sessionId || 'default';

    // Trace: open a top-level request span
    const requestSpan = this.trace.start({
      traceId,
      name: 'request',
      kind: 'request',
      data: { tool: ctx.toolRequest?.name }
    });

    // Timeline phases
    this.timeline.record({ traceId, phase: 'planning', detail: ctx.executionPlan });
    if (ctx.result) {
      this.timeline.record({
        traceId,
        phase: 'execution',
        detail: { ok: !!ctx.validation?.ok }
      });
    }

    // Metrics
    const latency = Date.now() - (ctx.lifecycle.startedAt || ctx.timestamp);
    this.metrics.record({ traceId, name: 'latency', value: latency, unit: 'ms' });
    if (ctx.state?.memoryRetrieve) {
      this.metrics.record({
        traceId,
        name: 'memoryHit',
        value: ctx.state.memoryRetrieve.count > 0
      });
    }

    // Execution chain
    const chain = this.recorder.recordFromContext(ctx, { traceId });

    // Close the top-level request span so TraceSpan is emitted
    this.trace.end({
      traceId,
      spanId: requestSpan.spanId,
      status: ctx.validation?.ok ? 'ok' : 'error'
    });

    return chain;
  }

  /** Snapshot of global metrics aggregates. */
  snapshot() {
    return this.metrics.snapshot();
  }
}

export default ObservabilityManager;
