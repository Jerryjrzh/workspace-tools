// src/runtime/workflows/WorkflowEngine.js
import { PlanningStage } from './PlanningStage.js';
import { ExecutionStage } from './ExecutionStage.js';
import { ValidationStage } from './ValidationStage.js';
import { ReviewStage } from './ReviewStage.js';
import { FinalizeStage } from './FinalizeStage.js';

/** Map of stage name → implementation. */
export const STAGE_IMPL = {
  planning: PlanningStage,
  execution: ExecutionStage,
  validation: ValidationStage,
  review: ReviewStage,
  finalize: FinalizeStage
};

/**
 * WorkflowEngine - runs a WorkflowDefinition by resolving its named steps to
 * stage implementations, then executing them as middleware on the runtime.
 *
 * This is definition-driven (not hardcoded), matching LangGraph/AutoGen style:
 *   const engine = new WorkflowEngine();
 *   const stages = engine.build(def);        // → [PlanningStage, ...]
 *   for (const stage of stages) runtime.use(stage);
 */
export class WorkflowEngine {
  constructor(options = {}) {
    this.stageImpl = options.stageImpl || STAGE_IMPL;
  }

  /**
   * Resolve a workflow definition into an ordered list of stage functions.
   * @param {WorkflowDefinition|Object} def
   * @returns {Array<Function>}
   */
  build(def) {
    const steps = def?.steps;
    if (!Array.isArray(steps)) {
      throw new Error('WorkflowEngine.build requires a definition with .steps array');
    }
    return this.resolveSteps(steps);
  }

  /**
   * Resolve an ordered list of step names into stage functions.
   * @param {Array<string|Object>} steps - e.g. ['planning','execution',...]
   */
  resolveSteps(steps) {
    const stages = [];
    for (const step of steps || []) {
      const name = typeof step === 'string' ? step : step?.name;
      const impl = this.stageImpl[name];
      if (!impl) {
        throw new Error(`Unknown workflow stage: ${name}`);
      }
      stages.push(impl);
    }
    return stages;
  }

  /**
   * Convenience: build the default full pipeline (planning → execution →
   * validation → review → finalize).
   */
  static defaultPipeline() {
    const engine = new WorkflowEngine();
    return engine.resolveSteps(['planning', 'execution', 'validation', 'review', 'finalize']);
  }
}

export default WorkflowEngine;
