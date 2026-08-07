// src/runtime/workflows/PolicyManager.js
import { ExecutionPolicy } from './ExecutionPolicy.js';
import { WorkflowDefinition } from './WorkflowDefinition.js';

/**
 * PolicyManager - registry of named policies + workflow definitions.
 *
 * Lets callers register reusable policies and workflows by name, then resolve
 * them at runtime instead of hardcoding stage wiring.
 */
export class PolicyManager {
  constructor() {
    this.policies = new Map();
    this.workflows = new Map();
  }

  /** Register a named ExecutionPolicy (or plain config). */
  registerPolicy(name, policy) {
    const resolved =
      policy instanceof ExecutionPolicy ? policy : new ExecutionPolicy(policy);
    resolved.validate();
    this.policies.set(name, resolved);
    return resolved;
  }

  /** Resolve a policy by name; returns null if absent. */
  getPolicy(name) {
    return this.policies.get(name) || null;
  }

  /** Register a named WorkflowDefinition (or plain config). */
  registerWorkflow(name, def) {
    const resolved =
      typeof def?.validate === 'function' ? def : WorkflowDefinition.fromJSON(def);
    resolved.validate();
    this.workflows.set(name, resolved);
    return resolved;
  }

  /** Resolve a workflow by name; returns null if absent. */
  getWorkflow(name) {
    return this.workflows.get(name) || null;
  }
}

export default PolicyManager;
