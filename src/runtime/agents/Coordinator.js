// src/runtime/agents/Coordinator.js
import { EventEmitter } from 'events';

/**
 * Coordinator - unified scheduler for multi-agent execution.
 *
 * Dispatches a Task to role-based agents (Review / Code / Search / Test /
 * Summary) and runs independent ones in parallel. Collects results into an
 * aggregate output with per-role verdicts.
 */
export class Coordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    // registry: role → agent instance
    this.agents = new Map(Object.entries(options.agents || {}));
    // default roles to dispatch (in order)
    this.defaultRoles =
      options.defaultRoles ||
      ['planner', 'search', 'review', 'test', 'summary'];
  }

  /** Register an agent under a role name. */
  register(role, agent) {
    this.agents.set(role, agent);
    return this;
  }

  /**
   * Dispatch a task to the given roles.
   * @param {Object} ctx - RuntimeContext or plain task data
   * @param {string[]} [roles] - roles to run (defaults to defaultRoles)
   * @returns {Promise<{ok, results: Object}>}
   */
  async dispatch(ctx, roles = this.defaultRoles) {
    const available = roles.filter((r) => this.agents.has(r));
    if (available.length === 0) {
      return { ok: false, results: {}, error: 'No agents registered' };
    }

    // Run all role agents in parallel
    const entries = await Promise.all(
      available.map(async (role) => {
        const agent = this.agents.get(role);
        try {
          const result = await agent.run(ctx);
          return { role, ok: !!result?.ok, output: result?.output ?? null };
        } catch (error) {
          return { role, ok: false, error: String(error?.message || error) };
        }
      })
    );

    // Aggregate results keyed by role
    const results = {};
    let allOk = true;
    for (const entry of entries) {
      results[entry.role] = entry;
      if (!entry.ok) allOk = false;
    }

    this.emit('coordinator:dispatch', { roles: available, ok: allOk });
    return { ok: allOk, results };
  }
}

export default Coordinator;
