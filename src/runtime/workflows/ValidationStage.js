// src/runtime/workflows/ValidationStage.js
import { TASK_STATES } from '../tasks/Task.js';

/**
 * ValidationStage - workflow pipeline stage that validates ToolResult.ok and
 * applies syntax guards before proceeding.
 *
 * On failure it marks the Task as Failed (unless policy says retry, which is
 * handled by ExecutionPolicy / downstream stages).
 */
export async function ValidationStage(ctx, next) {
  const task = ctx.task || null;
  const result = ctx.result;

  let ok = true;
  if (result && typeof result === 'object' && 'ok' in result) {
    ok = !!result.ok;
  }

  // Syntax guard: reject obviously malformed output
  if (typeof result?.error === 'string') {
    ok = false;
  }

  ctx.validation = { ok, checkedAt: Date.now() };

  if (!ok && task && typeof task.fail === 'function') {
    try {
      task.fail(result?.error || new Error('Validation failed'));
    } catch {
      /* already failed */
    }
  }

  task?.addTrace({ stage: 'ValidationStage', ok });
  return next();
}

export default ValidationStage;
