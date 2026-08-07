// src/runtime/observability/Trace.js

/**
 * Trace - full-chain span collector for Request → Task → Stage → Tool → Artifact.
 *
 * A span represents one unit of work with a start/end timestamp and parent
 * linkage. Traces are emitted to the EventBus (TraceSpan) so Observers can
 * subscribe without coupling, and also stored on ctx.trace / task.trace for
 * replay/debug.
 */
export class Trace {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    // active span stack keyed by traceId → array of open spans
    this._openSpans = new Map();
    // completed spans per traceId (ordered)
    this.spansByTrace = new Map();
  }

  /**
   * Start a span.
   * @param {Object} opts - { traceId, name, kind, parentSpanId, data }
   * @returns {{spanId: string}} the opened span handle
   */
  start(opts) {
    const traceId = opts.traceId || 'default';
    const spanId =
      opts.spanId ||
      `${traceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stackForParent = this._openSpans.get(traceId);
    const topOfStack = stackForParent && stackForParent.length > 0
      ? stackForParent[stackForParent.length - 1]
      : null;
    const parentSpanId = opts.parentSpanId || topOfStack?.spanId || null;

    const span = {
      spanId,
      traceId,
      name: opts.name || 'unnamed',
      kind: opts.kind || 'stage', // request | task | stage | tool | artifact
      parentSpanId,
      startTime: Date.now(),
      endTime: null,
      durationMs: null,
      data: { ...(opts.data || {}) },
      status: 'open'
    };

    const stack = this._openSpans.get(traceId) || [];
    stack.push(span);
    this._openSpans.set(traceId, stack);

    return span;
  }

  /**
   * End a span by its handle (or the top of the trace).
   * @param {Object} opts - { traceId, spanId?, status?, data? }
   * @returns {Object|null} completed span or null
   */
  end(opts) {
    const traceId = opts.traceId || 'default';
    const stack = this._openSpans.get(traceId);
    if (!stack || stack.length === 0) return null;

    let index =
      opts.spanId != null
        ? stack.findIndex((s) => s.spanId === opts.spanId)
        : -1;
    // default: close the most recently opened span (LIFO)
    if (index < 0 && opts.spanId == null) {
      index = stack.length - 1;
    }
    if (index < 0) return null;

    const [span] = stack.splice(index, 1);
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = opts.status || 'ok';
    if (opts.data) {
      Object.assign(span.data, opts.data);
    }

    // persist completed span
    const list = this.spansByTrace.get(traceId) || [];
    list.push(span);
    this.spansByTrace.set(traceId, list);

    // emit to EventBus observer channel
    if (this.eventBus?.traceSpan) {
      this.eventBus.traceSpan({ traceId, span });
    }

    return span;
  }

  /** Get all completed spans for a trace id. */
  getSpans(traceId = 'default') {
    return this.spansByTrace.get(traceId) || [];
  }

  /** Whether any spans are still open for a trace. */
  hasOpen(traceId = 'default') {
    const stack = this._openSpans.get(traceId);
    return !!stack && stack.length > 0;
  }

  /**
   * Convenience: run a function inside an auto-closed span.
   * @returns {Promise<{result, span}>}
   */
  async withSpan(opts, fn) {
    const span = this.start(opts);
    try {
      const result = await fn();
      this.end({ traceId: opts.traceId, spanId: span.spanId, status: 'ok' });
      return { result, span };
    } catch (error) {
      this.end({
        traceId: opts.traceId,
        spanId: span.spanId,
        status: 'error',
        data: { error: String(error?.message || error) }
      });
      throw error;
    }
  }

  /** Reset all collected spans for a trace (for fresh replay). */
  reset(traceId = 'default') {
    this._openSpans.delete(traceId);
    this.spansByTrace.set(traceId, []);
  }
}

export default Trace;
