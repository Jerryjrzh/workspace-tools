// src/runtime/workflows/FinalizeStage.js
import { TASK_STATES } from '../tasks/Task.js';

/**
 * FinalizeStage - workflow pipeline stage that concludes the task.
 *
 * If validation passed → complete(); otherwise leave Failed for retry/resume.
 */
export async function FinalizeStage(ctx, next) {
  const task = ctx.task || null;
  const ok = ctx.validation?.ok ?? true;

  if (task && typeof task.complete === 'function' && ok) {
    try {
      task.complete(ctx.result);
    } catch {
      /* already completed or invalid — leave as-is */
    }
  }

  ctx.finalized = { ok, finalizedAt: Date.now() };
  return next();
}

export default FinalizeStage;
