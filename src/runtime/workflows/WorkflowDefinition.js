// src/runtime/workflows/WorkflowDefinition.js
import { ExecutionPolicy } from './ExecutionPolicy.js';

/**
 * WorkflowDefinition - declarative (JSON/YAML) description of a workflow.
 *
 * Aligns with LangGraph/AutoGen's "flow driven by definition": the runtime reads
 * this config instead of hardcoding `new PlanningStage()` chains. A minimal YAML
 * parser is provided; callers may also pass plain JS objects directly.
 */
export class WorkflowDefinition {
  constructor(init = {}) {
    this.name = init.name || 'default';
    // ordered pipeline stage names: planning → execution → validation → review → finalize
    this.steps = Array.isArray(init.steps) ? [...init.steps] : [];
    this.policy =
      init.policy instanceof ExecutionPolicy
        ? init.policy
        : new ExecutionPolicy(init.policy || {});
  }

  /** Validate the definition shape. */
  validate() {
    if (!this.name) throw new Error('WorkflowDefinition requires a name');
    const allowed = ['planning', 'execution', 'validation', 'review', 'finalize'];
    for (const step of this.steps) {
      const key = typeof step === 'string' ? step : step?.name;
      if (!allowed.includes(key)) {
        throw new Error(`Unknown workflow step: ${key}`);
      }
    }
    this.policy.validate();
    return true;
  }

  /** Serialize to plain JSON. */
  toJSON() {
    return {
      name: this.name,
      steps: this.steps.map((s) =>
        typeof s === 'string' ? { name: s } : { ...s }
      ),
      policy: this.policy.toJSON()
    };
  }

  static fromJSON(data) {
    const def = new WorkflowDefinition({
      name: data.name,
      steps: (data.steps || []).map((s) =>
        typeof s === 'string' ? { name: s } : { ...s }
      ),
      policy: data.policy
    });
    return def;
  }

  /**
   * Parse a minimal YAML workflow definition into a WorkflowDefinition.
   * Supports the shape:
   *
   *   name: my-workflow
   *   steps:
   *     - planning
   *     - execution
   *     - validation
   *     - review
   *     - finalize
   *   policy:
   *     retry: 2
   *     timeoutMs: 60000
   */
  static fromYAML(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let name = 'default';
    const steps = [];
    const policyInit = {};
    let inSteps = false;
    let inPolicy = false;

    for (const line of lines) {
      if (/^name:\s*(.+)$/.test(line)) {
        name = line.match(/^name:\s*(.+)$/)[1].trim();
        continue;
      }
      if (/^steps:$/.test(line)) { inSteps = true; inPolicy = false; continue; }
      if (/^policy:$/.test(line)) { inPolicy = true; inSteps = false; continue; }
      if (inSteps && /^\-\s+(.+)$/.test(line)) {
        steps.push({ name: line.match(/^\-\s+(.+)$/)[1].trim() });
        continue;
      }
      if (inPolicy) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m) {
          const key = m[1];
          let val = m[2].replace(/['"]/g, '').trim();
          policyInit[key] =
            /^\d+$/.test(val)
              ? Number(val)
              : /^(true|false)$/i.test(val)
                ? /^true$/i.test(val)
                : val;
        }
      }
    }

    return new WorkflowDefinition({ name, steps, policy: policyInit });
  }
}

export default WorkflowDefinition;
