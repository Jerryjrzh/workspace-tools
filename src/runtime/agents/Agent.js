// src/runtime/agents/Agent.js
import { EventEmitter } from 'events';

/**
 * Agent - base class for all multi-agent roles.
 *
 * Each agent has a role, can run against a RuntimeContext (or plain task data),
 * and emits `agent:run` events so Observers / Coordinator can track progress.
 */
export class Agent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.role = options.role || 'general';
    this.name = options.name || `${this.role}_${Date.now()}`;
    // capability hints (e.g. ['file_read', 'shell_run'])
    this.capabilities = Array.isArray(options.capabilities)
      ? [...options.capabilities]
      : [];
  }

  /**
   * Run the agent against a context/task.
   * @param {Object} ctx - RuntimeContext or plain task data
   * @returns {Promise<{ok: boolean, output?: any}>}
   */
  async run(ctx) {
    this.emit('agent:start', { name: this.name, role: this.role });
    const result = await this.execute(ctx);
    this.emit('agent:end', { name: this.name, role: this.role, ok: !!result?.ok });
    return result;
  }

  /**
   * Agent-specific execution logic — override in subclasses.
   */
  async execute(_ctx) {
    throw new Error(`${this.name}.execute must be implemented`);
  }
}

export default Agent;
