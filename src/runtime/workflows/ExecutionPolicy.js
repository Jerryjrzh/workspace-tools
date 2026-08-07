// src/runtime/workflows/ExecutionPolicy.js

/**
 * ExecutionPolicy - declarative rules controlling how a workflow runs.
 *
 * Fields:
 *   retry          max retries before failing
 *   timeoutMs      per-tool execution timeout (0 = none)
 *   parallel       whether independent steps may run in parallel
 *   maxDepth       maximum pipeline recursion depth
 *   checkpointFreq save a Task checkpoint every N steps (0 = off)
 *   autoReview     automatically move to ReviewStage after execution
 *   manualReview   require human/agent confirmation before finalize
 */
export class ExecutionPolicy {
  constructor(init = {}) {
    this.retry = init.retry ?? 0;
    this.timeoutMs = init.timeoutMs ?? 30000;
    this.parallel = !!init.parallel;
    this.maxDepth = init.maxDepth ?? 10;
    this.checkpointFreq = init.checkpointFreq ?? 1;
    this.autoReview = init.autoReview !== false; // default on
    this.manualReview = !!init.manualReview;
  }

  /** Validate the policy shape, throwing on invalid values. */
  validate() {
    if (!Number.isInteger(this.retry) || this.retry < 0) {
      throw new Error('ExecutionPolicy.retry must be a non-negative integer');
    }
    if (this.timeoutMs < 0) {
      throw new Error('ExecutionPolicy.timeoutMs must be >= 0');
    }
    if (!Number.isInteger(this.maxDepth) || this.maxDepth <= 0) {
      throw new Error('ExecutionPolicy.maxDepth must be a positive integer');
    }
    return true;
  }

  /** Serialize to plain JSON. */
  toJSON() {
    return { ...this };
  }

  static fromJSON(data) {
    return new ExecutionPolicy(data);
  }
}

export default ExecutionPolicy;
