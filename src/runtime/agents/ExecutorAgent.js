// src/runtime/agents/ExecutorAgent.js
import { Agent } from './Agent.js';
import { executeTool } from '../toolRouter.js';

/**
 * ExecutorAgent - executes a single tool call via toolRouter.
 *
 * Captures failures instead of throwing so the Coordinator can decide retry /
 * fail policy. Optionally honors an ExecutionPolicy timeout.
 */
export class ExecutorAgent extends Agent {
  constructor(options = {}) {
    super({ role: 'executor', ...options });
  }

  async execute(ctx) {
    const name = ctx.toolRequest?.name;
    if (!name) {
      return { ok: false, output: null, error: 'No tool requested' };
    }

    // Honor ExecutionPolicy timeout if present
    const policy = ctx.executionPolicy || {};
    let result;
    try {
      if (policy.timeoutMs > 0) {
        result = await Promise.race([
          executeTool(name, ctx.toolRequest.args || {}, ctx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('tool timeout')), policy.timeoutMs)
          )
        ]);
      } else {
        result = await executeTool(name, ctx.toolRequest.args || {}, ctx);
      }
    } catch (error) {
      return { ok: false, output: null, error };
    }

    const ok =
      typeof result === 'object' && result !== null && 'ok' in result
        ? !!result.ok
        : true;
    return { ok, output: result };
  }
}

export default ExecutorAgent;
