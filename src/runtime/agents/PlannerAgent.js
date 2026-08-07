// src/runtime/agents/PlannerAgent.js
import { Agent } from './Agent.js';

/**
 * PlannerAgent - produces an execution plan for a task.
 *
 * Reuses the PlanningStage logic shape: reads goal / context and derives steps,
 * optionally guided by a workflow definition on ctx.workflowDefinition.
 */
export class PlannerAgent extends Agent {
  constructor(options = {}) {
    super({ role: 'planner', ...options });
  }

  async execute(ctx) {
    const task = ctx.task || null;
    const plan = {
      goal: task?.goal || ctx.goal || '',
      strategy: 'multi-agent',
      steps: [],
      hints: []
    };

    // Derive steps from a workflow definition if present
    const def = ctx.workflowDefinition;
    if (def && Array.isArray(def.steps)) {
      plan.steps = def.steps.map((s) => ({
        name: s.name || s,
        tool: s.tool || null,
        status: 'pending'
      }));
    }

    // Fallback: derive a minimal step list from the goal
    if (plan.steps.length === 0 && plan.goal) {
      plan.steps = [
        { name: 'search', tool: 'file_search', status: 'pending' },
        { name: 'review', tool: null, status: 'pending' },
        { name: 'report', tool: null, status: 'pending' }
      ];
    }

    if (task && typeof task.addTrace === 'function') {
      task.addTrace({ stage: 'PlannerAgent', plan });
    }
    return { ok: true, output: plan };
  }
}

export default PlannerAgent;
