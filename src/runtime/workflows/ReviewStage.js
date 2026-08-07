// src/runtime/workflows/ReviewStage.js
import { TASK_STATES } from '../tasks/Task.js';

/**
 * ReviewStage - workflow pipeline stage that moves the Task into review and
 * records a lightweight review verdict on ctx.review.
 *
 * A full Reviewer agent (Phase 5) can replace/extend this later; for now it
 * captures whether validation passed so FinalizeStage knows how to conclude.
 */
export async function ReviewStage(ctx, next) {
  const task = ctx.task || null;
  const ok = ctx.validation?.ok ?? true;

  if (task && typeof task.review === 'function') {
    try {
      task.review();
    } catch {
      /* already reviewing or invalid — leave as-is */
    }
  }

  ctx.review = {
    verdict: ok ? 'pass' : 'fail',
    reviewedAt: Date.now()
  };

  task?.addTrace({ stage: 'ReviewStage', verdict: ctx.review.verdict });
  return next();
}

export default ReviewStage;
