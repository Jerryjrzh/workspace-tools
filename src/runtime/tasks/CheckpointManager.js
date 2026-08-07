// src/runtime/tasks/CheckpointManager.js
import { Task } from './Task.js';

/**
 * CheckpointManager - save / restore / rollback / resume for long-running tasks.
 *
 * Integrates with Task.state so a task can be recovered or rolled back after an
 * interruption. Delegates persistence to the owning TaskManager's repository.
 */
export class CheckpointManager {
  constructor(taskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Save a checkpoint for a task and persist it.
   * @returns {number} checkpoint index
   */
  save(taskId) {
    const task = this._requireTask(taskId);
    const index = task.saveCheckpoint();
    this.taskManager.update(task);
    return index;
  }

  /**
   * Restore the latest (or indexed) checkpoint without changing state.
   * Returns the restored snapshot or null if none exists.
   */
  restore(taskId, checkpointIndex = -1) {
    const task = this._requireTask(taskId);
    const target =
      checkpointIndex >= 0
        ? task.checkpoints[checkpointIndex]
        : task.checkpoints[task.checkpoints.length - 1];
    return target || null;
  }

  /**
   * Rollback a task to a previous checkpoint → Ready for re-execution.
   * Persists the restored state. Returns true on success, false if no snapshot.
   */
  rollback(taskId, checkpointIndex = -1) {
    const task = this._requireTask(taskId);
    const target =
      checkpointIndex >= 0
        ? task.checkpoints[checkpointIndex]
        : task.checkpoints[task.checkpoints.length - 1];
    if (!target) return false;

    task.context = { ...(target.context || {}) };
    task.artifacts = { ...(target.artifacts || {}) };
    task.result = target.result ?? null;
    task.metadata.updatedAt = Date.now();
    // Move back to Ready so execution can re-run
    if (task.state !== 'Ready') {
      try {
        task.transition('Ready');
      } catch {
        /* already ready */
      }
    }
    this.taskManager.update(task);
    return true;
  }

  /**
   * Resume a waiting/failed task back to executing/ready and persist.
   * @returns {Task}
   */
  resume(taskId) {
    const task = this._requireTask(taskId);
    if (task.state === 'Failed') {
      task.retry();
    } else if (task.state === 'Waiting' || task.state === 'Ready') {
      task.resume();
    }
    this.taskManager.update(task);
    return task;
  }

  /** Internal: load a Task or throw. */
  _requireTask(taskId) {
    const task = this.taskManager.load(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}

export default CheckpointManager;
