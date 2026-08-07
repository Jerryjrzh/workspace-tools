// src/runtime/agents/ReviewerAgent.js
import { Agent } from './Agent.js';

/**
 * ReviewerAgent - reviews task output / artifacts and produces a verdict.
 *
 * Lightweight rule-based review: checks validation.ok, artifact presence, and
 * emits findings. A full LLM reviewer can extend this later (Phase 5 mature).
 */
export class ReviewerAgent extends Agent {
  constructor(options = {}) {
    super({ role: 'reviewer', ...options });
  }

  async execute(ctx) {
    const task = ctx.task || null;
    const result = ctx.result ?? task?.result ?? null;

    const findings = [];
    let verdict = 'pass';

    // Rule 1: validation must pass
    if (ctx.validation && !ctx.validation.ok) {
      verdict = 'fail';
      findings.push({ severity: 'error', message: 'Validation failed' });
    }

    // Rule 2: result should be present
    if (!result || (typeof result === 'object' && result.ok === false)) {
      verdict = 'fail';
      findings.push({ severity: 'error', message: 'No successful result produced' });
    }

    // Rule 3: artifacts referenced by the task should exist in index
    const artifacts = task?.artifacts || {};
    if (Object.keys(artifacts).length === 0) {
      findings.push({
        severity: 'warn',
        message: 'Task has no artifact references attached'
      });
    }

    return { ok: true, output: { verdict, findings } };
  }
}

export default ReviewerAgent;
