// src/runtime/tasks/TaskManager.js
import { Task } from './Task.js';
import { TaskRepository } from './TaskRepository.js';

/**
 * TaskManager - create / load / update / archive Tasks.
 *
 * Owns a TaskRepository for persistence and exposes high-level operations so
 * tools (e.g. src/tools/task.js) can delegate instead of duplicating logic.
 */
export class TaskManager {
  constructor(options = {}) {
    this.repository =
      options.repository || new TaskRepository({ baseDir: options.baseDir });
    // in-memory cache keyed by task id
    this._cache = new Map();
  }

  /**
   * Create a new Task and persist it.
   * @returns {Task}
   */
  create(init = {}) {
    const task = new Task(init);
    this.repository.save(task.toJSON());
    this._cache.set(task.id, task);
    return task;
  }

  /** Load a Task by id (from cache or repository). Returns null if absent. */
  load(taskId) {
    if (this._cache.has(taskId)) {
      return this._cache.get(taskId);
    }
    const data = this.repository.load(taskId);
    if (!data) return null;
    const task = Task.fromJSON(data);
    this._cache.set(taskId, task);
    return task;
  }

  /** Update a persisted task (re-saves current state). */
  update(task) {
    if (!(task instanceof Task)) {
      throw new Error('TaskManager.update expects a Task instance');
    }
    const data = task.toJSON();
    this.repository.save(data);
    this._cache.set(task.id, task);
    return task;
  }

  /** Archive a completed task (Completed → Archived) and persist. */
  archive(taskId) {
    const task = this.load(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    task.archive();
    this.update(task);
    return task;
  }

  /** Delete a task from repository + cache. Returns true if removed. */
  delete(taskId) {
    this._cache.delete(taskId);
    return this.repository.delete(taskId);
  }

  /**
   * List tasks.
   * @param {string} [status] - 'all' | 'pending' | 'done'
   * @returns {Array<Object>} serialized task objects
   */
  list(status = 'all') {
    return this.repository.list(status);
  }
}

export default TaskManager;
