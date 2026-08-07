// src/runtime/agents/MultiAgentManager.js
import { Coordinator } from './Coordinator.js';
import { Consensus } from './Consensus.js';

/**
 * MultiAgentManager - facade wiring Coordinator + Consensus for Phase 5.
 *
 * Registers role agents, dispatches a task via the Coordinator, then runs the
 * collected results through Consensus to produce a final decision.
 */
export class MultiAgentManager {
  constructor(options = {}) {
    this.coordinator =
      options.coordinator || new Coordinator({ agents: options.agents });
    this.consensus = options.consensus || new Consensus({ weights: options.weights });
  }

  /** Register an agent under a role name (delegates to Coordinator). */
  register(role, agent) {
    this.coordinator.register(role, agent);
    return this;
  }

  /**
   * Dispatch a task and compute consensus.
   * @param {Object} ctx - RuntimeContext or plain task data
   * @param {string[]} [roles]
   * @returns {Promise<{dispatch, consensus}>}
   */
  async run(ctx, roles) {
    const dispatch = await this.coordinator.dispatch(ctx, roles);
    // Build consensus entries from the dispatched results
    const entries = Object.values(dispatch.results).map((r) => ({
      role: r.role,
      ok: r.ok,
      output: r.output ?? null
    }));
    const decision = this.consensus.decide(entries);

    return { dispatch, consensus: decision };
  }
}

export default MultiAgentManager;
