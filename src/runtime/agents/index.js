// src/runtime/agents/index.js
export { Agent } from './Agent.js';
export { Coordinator } from './Coordinator.js';
export { PlannerAgent } from './PlannerAgent.js';
export { ExecutorAgent } from './ExecutorAgent.js';
export { ReviewerAgent } from './ReviewerAgent.js';
export { MemoryAgent } from './MemoryAgent.js';
export { ReflectionAgent } from './ReflectionAgent.js';
export { Consensus } from './Consensus.js';
export { MultiAgentManager } from './MultiAgentManager.js';

import { Agent } from './Agent.js';
import { Coordinator } from './Coordinator.js';
import { PlannerAgent } from './PlannerAgent.js';
import { ExecutorAgent } from './ExecutorAgent.js';
import { ReviewerAgent } from './ReviewerAgent.js';
import { MemoryAgent } from './MemoryAgent.js';
import { ReflectionAgent } from './ReflectionAgent.js';
import { Consensus } from './Consensus.js';
import { MultiAgentManager } from './MultiAgentManager.js';

/**
 * Convenience factory: a wired Multi-Agent system with all default roles.
 */
export function createMultiAgentSystem(options = {}) {
  const coordinator = new Coordinator({
    agents: {
      planner: options.planner || new PlannerAgent(),
      executor: options.executor || new ExecutorAgent(),
      reviewer: options.reviewer || new ReviewerAgent(),
      memory: options.memory || new MemoryAgent(),
      reflection: options.reflection || new ReflectionAgent()
    }
  });

  return {
    coordinator,
    consensus: new Consensus({ weights: options.weights }),
    agents: coordinator
  };
}

export default {
  Agent,
  Coordinator,
  PlannerAgent,
  ExecutorAgent,
  ReviewerAgent,
  MemoryAgent,
  ReflectionAgent,
  Consensus,
  MultiAgentManager
};
