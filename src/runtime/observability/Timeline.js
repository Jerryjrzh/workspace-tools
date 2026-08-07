// src/runtime/observability/Timeline.js

/**
 * Timeline - ordered event log for Planning / Search / Review / Report phases.
 *
 * Each entry has a phase, timestamp, and optional detail. Useful for debugging
 * the order of operations across a request lifecycle.
 */
export class Timeline {
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    // entries per traceId (ordered)
    this._entriesByTrace = new Map();
  }

  /**
   * Record a timeline event.
   * @param {Object} opts - { traceId, phase, detail?, level? }
   */
  record(opts) {
    const traceId = opts.traceId || 'default';
    const entry = {
      id: `${traceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      traceId,
      phase: opts.phase || 'unknown', // planning | search | review | report ...
      detail: opts.detail ?? null,
      level: opts.level || 'info',
      timestamp: Date.now()
    };

    const list = this._entriesByTrace.get(traceId) || [];
    list.push(entry);
    this._entriesByTrace.set(traceId, list);

    if (this.eventBus?.timelineEvent) {
      this.eventBus.timelineEvent({ traceId, entry });
    }

    return entry;
  }

  /** Get all timeline entries for a trace id. */
  getEntries(traceId = 'default') {
    return this._entriesByTrace.get(traceId) || [];
  }

  /**
   * Convenience: record start + end around an async function.
   * @returns {Promise<{result, entry}>}
   */
  async withPhase(opts, fn) {
    const start = this.record({ ...opts, phase: opts.phase });
    try {
      const result = await fn();
      this.record({
        traceId: opts.traceId,
        phase: `${opts.phase}:end`,
        detail: { ok: true },
        level: 'info'
      });
      return { result, entry: start };
    } catch (error) {
      this.record({
        traceId: opts.traceId,
        phase: `${opts.phase}:end`,
        detail: { ok: false, error: String(error?.message || error) },
        level: 'error'
      });
      throw error;
    }
  }

  /** Reset timeline for a trace (for fresh replay). */
  reset(traceId = 'default') {
    this._entriesByTrace.set(traceId, []);
  }
}

export default Timeline;
