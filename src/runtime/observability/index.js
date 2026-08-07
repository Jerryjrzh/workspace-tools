// src/runtime/observability/index.js
export { Trace } from './Trace.js';
export { Timeline } from './Timeline.js';
export { Metrics } from './Metrics.js';
export { ExecutionRecorder } from './ExecutionRecorder.js';
export { ObservabilityManager } from './ObservabilityManager.js';

import { Trace } from './Trace.js';
import { Timeline } from './Timeline.js';
import { Metrics } from './Metrics.js';
import { ExecutionRecorder } from './ExecutionRecorder.js';
import { ObservabilityManager } from './ObservabilityManager.js';

/** Convenience factory: a wired ObservabilityManager. */
export function createObservability(options = {}) {
  return new ObservabilityManager(options);
}

export default {
  Trace,
  Timeline,
  Metrics,
  ExecutionRecorder,
  ObservabilityManager
};
