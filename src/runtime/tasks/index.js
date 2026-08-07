// src/runtime/tasks/index.js
export { Task, TASK_STATES, TASK_TRANSITIONS } from './Task.js';
export { TaskManager } from './TaskManager.js';
export { TaskRepository } from './TaskRepository.js';
export { CheckpointManager } from './CheckpointManager.js';

import { Task, TASK_STATES } from './Task.js';
import { TaskRepository } from './TaskRepository.js';
import { TaskManager } from './TaskManager.js';
import { CheckpointManager } from './CheckpointManager.js';

/** Convenience factory: a wired TaskManager + CheckpointManager pair. */
export function createTaskSystem(options = {}) {
  const manager = new TaskManager(options);
  return {
    tasks: manager,
    checkpoints: new CheckpointManager(manager)
  };
}

export default { Task, TASK_STATES, TaskManager, TaskRepository, CheckpointManager };
