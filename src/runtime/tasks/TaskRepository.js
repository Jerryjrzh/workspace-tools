// src/runtime/tasks/TaskRepository.js
import fs from 'fs';
import path from 'path';

/**
 * TaskRepository - persistence layer for Tasks.
 *
 * Persists to `.lmstudio-task-checkpoints/*.json` (reusing the existing task.js
 * directory convention) so legacy checkpoints and new Task objects coexist.
 */
export class TaskRepository {
  constructor(options = {}) {
    this.baseDir =
      options.baseDir ||
      path.join(process.cwd(), '.lmstudio-task-checkpoints');
  }

  /** Resolve the file path for a task id. */
  _filePath(taskId) {
    return path.join(this.baseDir, `${taskId}.json`);
  }

  /**
   * Save (create or update) a serialized task.
   * @param {Object} data - Task.toJSON() output
   */
  save(data) {
    if (!data || !data.id) {
      throw new Error('TaskRepository.save requires an object with .id');
    }
    fs.mkdirSync(this.baseDir, { recursive: true });
    const file = this._filePath(data.id);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  /** Load a single task by id; returns parsed object or null. */
  load(taskId) {
    const file = this._filePath(taskId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Delete a task by id. Returns true if it existed and was removed. */
  delete(taskId) {
    const file = this._filePath(taskId);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  /**
   * List all persisted tasks, newest first.
   * @param {string} [status] - optional filter: 'all' | 'pending' | 'done'
   */
  list(status = 'all') {
    if (!fs.existsSync(this.baseDir)) return [];
    const files = fs.readdirSync(this.baseDir)
      .filter((f) => f.endsWith('.json'))
      .map((name) => ({
        name,
        mtime: fs.statSync(path.join(this.baseDir, name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const tasks = [];
    for (const { name } of files) {
      const data = this.load(name.replace('.json', ''));
      if (!data) continue;
      if (status === 'pending' && isDone(data)) continue;
      if (status === 'done' && !isDone(data)) continue;
      tasks.push(data);
    }
    return tasks;
  }

  /** Whether a serialized task has all steps done. */
  static isDone(data) {
    const steps = data.steps || [];
    return steps.length > 0 && steps.every((s) => s.status === 'done');
  }
}

function isDone(data) {
  return TaskRepository.isDone(data);
}

export default TaskRepository;
