// src/runtime/agents/ReflectionAgent.js
import { Agent } from './Agent.js';

/**
 * ReflectionAgent - reflects on execution results to produce lessons /
 * improvements for future steps.
 *
 * Analyzes the task trace + result and emits structured reflections:
 * what worked, what failed, next-action suggestions.
 */
export class ReflectionAgent extends Agent {
  constructor(options = {}) {
    super({ role: 'reflection', ...options });
  }

  async execute(ctx) {
    const task = ctx.task || null;
    const trace = task?.trace || [];
    const result = ctx.result ?? task?.result ?? null;

    const reflections = [];

    // Reflect on failed steps in the trace
    const failures = trace.filter((t) => t.ok === false);
    if (failures.length > 0) {
      reflections.push({
        type: 'failure',
        message: `${failures.length} step(s) failed`,
        suggestion: 'Retry with adjusted policy or rollback to checkpoint'
      });
    }

    // Reflect on overall result
    const ok =
      typeof result === 'object' && result !== null && 'ok' in result
        ? !!result.ok
        : true;
    if (!ok) {
      reflections.push({
        type: 'outcome',
        message: 'Task did not complete successfully',
        suggestion: 'Consider resume() or retry()'
      });
    } else {
      reflections.push({
        type: 'outcome',
        message: 'Task completed successfully',
        suggestion: 'Archive and persist artifacts'
      });
    }

    return { ok: true, output: { reflections } };
  }
}

export default ReflectionAgent;
