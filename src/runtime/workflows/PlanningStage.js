// src/runtime/workflows/PlanningStage.js
import { TASK_STATES } from '../tasks/Task.js';

/**
 * PlanningStage - workflow pipeline stage that produces an execution plan.
 *
 * Reuses the existing PlannerStage logic shape but operates on a Task object:
 * it reads task.goal / context and writes ctx.executionPlan + task.state=Planning.
 */
export async function PlanningStage(ctx, next) {
  const task = ctx.task || null;

  if (task && typeof task.plan === 'function' && task.getState() === TASK_STATES.CREATED) {
    try {
      task.plan();
    } catch {
      /* already planning or invalid — leave as-is */
    }
  }

  const plan = {
    goal: task?.goal || ctx.toolRequest?.name || '',
    strategy: 'workflow',
    steps: [],
    hints: []
  };

  // Derive a minimal step list from the workflow definition if present
  const def = ctx.workflowDefinition;
  if (def && Array.isArray(def.steps)) {
    plan.steps = def.steps.map((s) => ({
      name: s.name || s,
      tool: s.tool || null,
      status: 'pending'
    }));
  }

  task?.addTrace({ stage: 'PlanningStage', plan });
  ctx.executionPlan = plan;
  return next();
}

export default PlanningStage;
