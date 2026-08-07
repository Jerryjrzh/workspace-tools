// src/runtime/workflows/ExecutionStage.js
import { executeTool } from '../toolRouter.js';
import { TASK_STATES } from '../tasks/Task.js';

/**
 * ExecutionStage - workflow pipeline stage that runs the requested tool.
 *
 * Calls toolRouter.executeTool and stores the raw output on ctx.result, then
 * advances the Task to Executing. Validation happens in a later stage so this
 * stage stays focused on execution only.
 */
export async function ExecutionStage(ctx, next) {
  const task = ctx.task || null;
  const name = ctx.toolRequest?.name;

  if (task && typeof task.execute === 'function') {
    try {
      task.execute();
    } catch {
      /* state already executing or invalid — leave as-is */
    }
  }

  let result = null;
  if (name) {
    // Execute the tool; failures are captured rather than thrown so downstream
    // ValidationStage can decide retry / fail policy.
    try {
      result = await executeTool(name, ctx.toolRequest.args || {}, ctx);
    } catch (error) {
      result = { ok: false, error };
    }
  }

  ctx.result = result;
  task?.addTrace({ stage: 'ExecutionStage', tool: name, ok: !!result?.ok });
  return next();
}

export default ExecutionStage;
