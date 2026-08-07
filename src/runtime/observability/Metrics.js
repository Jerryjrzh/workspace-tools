// src/runtime/observability/Metrics.js

/**
 * Metrics - quantitative counters for Latency / Tool Time / Memory Hit /
 * Context Size / Retry / Failure / Confidence.
 *
 * Aggregates per trace and globally, emitted to the EventBus (MetricRecorded).
 */
export class Metrics {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    // global counters
    this.global = {
      latencyMs: [],
      toolTimeMs: [],
      memoryHits: 0,
      contextSizes: [],
      retries: 0,
      failures: 0,
      confidenceValues: []
    };
    // per-trace aggregates keyed by traceId
    this._byTrace = new Map();
  }

  /**
   * Record a metric.
   * @param {Object} opts - { traceId, name, value, unit? }
   */
  record(opts) {
    const traceId = opts.traceId || 'default';
    const entry = {
      traceId,
      name: opts.name,
      value: opts.value,
      unit: opts.unit || null,
      timestamp: Date.now()
    };

    // global aggregation
    switch (opts.name) {
      case 'latency':
        this.global.latencyMs.push(opts.value);
        break;
      case 'toolTime':
        this.global.toolTimeMs.push(opts.value);
        break;
      case 'memoryHit':
        if (opts.value === true || opts.value > 0) {
          this.global.memoryHits += 1;
        }
        break;
      case 'contextSize':
        this.global.contextSizes.push(opts.value);
        break;
      case 'retry':
        this.global.retries += opts.value ?? 1;
        break;
      case 'failure':
        if (opts.value === true || opts.value > 0) {
          this.global.failures += 1;
        }
        break;
      case 'confidence':
        this.global.confidenceValues.push(opts.value);
        break;
    }

    // per-trace storage
    const list = this._byTrace.get(traceId) || [];
    list.push(entry);
    this._byTrace.set(traceId, list);

    if (this.eventBus?.metricRecorded) {
      this.eventBus.metricRecorded({ traceId, entry });
    }

    return entry;
  }

  /** Get all metric entries for a trace. */
  getEntries(traceId = 'default') {
    return this._byTrace.get(traceId) || [];
  }

  /**
   * Compute summary stats (min/avg/max/count) over an array of numbers.
   */
  static summarize(values) {
    if (!values || values.length === 0) {
      return { count: 0, min: null, avg: null, max: null };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
      count: sorted.length,
      min: sorted[0],
      avg: sum / sorted.length,
      max: sorted[sorted.length - 1]
    };
  }

  /** Snapshot of global aggregates. */
  snapshot() {
    const g = this.global;
    return {
      latencyMs: Metrics.summarize(g.latencyMs),
      toolTimeMs: Metrics.summarize(g.toolTimeMs),
      memoryHits: g.memoryHits,
      contextSizes: Metrics.summarize(g.contextSizes),
      retries: g.retries,
      failures: g.failures,
      confidenceValues: Metrics.summarize(g.confidenceValues)
    };
  }

  /** Reset all metrics (for fresh benchmark). */
  reset() {
    this.global = {
      latencyMs: [],
      toolTimeMs: [],
      memoryHits: 0,
      contextSizes: [],
      retries: 0,
      failures: 0,
      confidenceValues: []
    };
    this._byTrace.clear();
  }
}

export default Metrics;
