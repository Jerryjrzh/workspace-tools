// src/runtime/tasks/Task.js
import { EventEmitter } from 'events';

/**
 * Task state machine states.
 *
 * Lifecycle:
 *   Created → Planning → Ready → Executing ⇄ Waiting
 *                                    ↓
 *                              Reviewing → Completed → Archived
 *
 * Failure paths: any active state may transition to Failed (via retry()/cancel()),
 * and Failed can return to Ready via resume() or rollback().
 */
export const TASK_STATES = Object.freeze({
  CREATED: 'Created',
  PLANNING: 'Planning',
  READY: 'Ready',
  EXECUTING: 'Executing',
  WAITING: 'Waiting',
  REVIEWING: 'Reviewing',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
  FAILED: 'Failed'
});

/**
 * Allowed transitions for the state machine.
 */
export const TASK_TRANSITIONS = Object.freeze({
  [TASK_STATES.CREATED]: new Set([TASK_STATES.PLANNING, TASK_STATES.FAILED]),
  [TASK_STATES.PLANNING]: new Set([TASK_STATES.READY, TASK_STATES.FAILED]),
  [TASK_STATES.READY]: new Set([
    TASK_STATES.EXECUTING,
    TASK_STATES.WAITING,
    TASK_STATES.COMPLETED,
    TASK_STATES.FAILED
  ]),
  [TASK_STATES.EXECUTING]: new Set([
    TASK_STATES.READY, // retry / rollback
    TASK_STATES.WAITING,
    TASK_STATES.REVIEWING,
    TASK_STATES.COMPLETED,
    TASK_STATES.FAILED
  ]),
  [TASK_STATES.WAITING]: new Set([
    TASK_STATES.EXECUTING, // resume
    TASK_STATES.FAILED
  ]),
  [TASK_STATES.REVIEWING]: new Set([
    TASK_STATES.COMPLETED,
    TASK_STATES.FAILED,
    TASK_STATES.EXECUTING // re-execute after review feedback
  ]),
  [TASK_STATES.COMPLETED]: new Set([TASK_STATES.ARCHIVED]),
  [TASK_STATES.FAILED]: new Set([
    TASK_STATES.READY, // retry / resume
    TASK_STATES.CREATED // rollback to re-plan
  ]),
  [TASK_STATES.ARCHIVED]: new Set([])
});

/**
 * Task - unified object model for long-running agent work.
 *
 * Fields:
 *   id / goal / state / context / artifacts / checkpoints / result / trace
 * Plus `metadata` (priority/owner/createdAt/updatedAt/runtimeVersion/
 * capabilities/labels/confidence) so Planner/Review/Trace can reuse it without
 * growing the core Task shape.
 */
export class Task extends EventEmitter {
  constructor(init = {}) {
    super();
    const now = Date.now();

    this.id = init.id || `task_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.goal = init.goal || '';
    this.state = TASK_STATES[init.state] || TASK_STATES.CREATED;
    this.context = { ...(init.context || {}) };
    // artifacts: map of name → artifact reference (path / id). Memory stores only indexes.
    this.artifacts = { ...(init.artifacts || {}) };
    // checkpoints: array of saved snapshots for rollback/resume
    this.checkpoints = Array.isArray(init.checkpoints) ? [...init.checkpoints] : [];
    this.result = init.result ?? null;
    // trace: ordered execution chain entries (prompt → plan → tool → artifact)
    this.trace = Array.isArray(init.trace) ? [...init.trace] : [];

    this.metadata = {
      priority: init.priority ?? 0,
      owner: init.owner || null,
      createdAt: init.createdAt || now,
      updatedAt: init.updatedAt || now,
      runtimeVersion: init.runtimeVersion || null,
      capabilities: Array.isArray(init.capabilities) ? [...init.capabilities] : [],
      labels: { ...(init.labels || {}) },
      confidence: init.confidence ?? 0
    };

    this.steps = Array.isArray(init.steps)
      ? init.steps.map((s, i) => ({
          index: s.index ?? i,
          text: s.text || '',
          status: s.status || 'pending',
          result: s.result || null
        }))
      : [];
  }

  /** Current state name. */
  getState() {
    return this.state;
  }

  /**
   * Transition to a new state, validating against the allowed transition table.
   * Emits `state:change` on success and throws on invalid transitions.
   */
  transition(nextState) {
    const from = this.state;

    if (!TASK_TRANSITIONS[from] || !TASK_TRANSITIONS[from].has(nextState)) {
      throw new Error(`Invalid task state transition: ${from} → ${nextState}`);
    }

    this.state = nextState;
    this.metadata.updatedAt = Date.now();
    this.emit('state:change', { from, to: nextState, taskId: this.id });
    return this;
  }

  // ─────────────────────────── Transition helpers ───────────────────────────

  /** Start planning (Created → Planning). */
  plan() {
    return this.transition(TASK_STATES.PLANNING);
  }

  /** Mark ready for execution (Planning → Ready, or Failed → Ready via retry). */
  ready() {
    return this.transition(TASK_STATES.READY);
  }

  /** Begin executing (Ready/Reviewing → Executing). */
  execute() {
    if (![TASK_STATES.READY, TASK_STATES.REVIEWING].includes(this.state)) {
      throw new Error(`Cannot execute from state: ${this.state}`);
    }
    return this.transition(TASK_STATES.EXECUTING);
  }

  /** Pause execution (Executing → Waiting). */
  wait() {
    return this.transition(TASK_STATES.WAITING);
  }

  /** Resume a waiting/failed task back to executing/ready. */
  resume() {
    if (this.state === TASK_STATES.FAILED) {
      return this.transition(TASK_STATES.READY);
    }
    return this.transition(TASK_STATES.EXECUTING);
  }

  /** Move into review (Executing → Reviewing). */
  review() {
    return this.transition(TASK_STATES.REVIEWING);
  }

  /** Complete the task (Reviewing/Ready/Executing → Completed). */
  complete(result) {
    if (result !== undefined) {
      this.result = result;
    }
    return this.transition(TASK_STATES.COMPLETED);
  }

  /** Archive a completed task. */
  archive() {
    return this.transition(TASK_STATES.ARCHIVED);
  }

  /** Mark failed; can be retried/resumed/rolled back afterwards. */
  fail(error) {
    if (error !== undefined && error !== null) {
      this.result = { ok: false, error };
    }
    return this.transition(TASK_STATES.FAILED);
  }

  /**
   * Retry a failed task → Ready for re-execution.
   * Optionally clears the previous result so execution starts fresh.
   */
  retry() {
    if (this.state !== TASK_STATES.FAILED) {
      throw new Error(`Cannot retry from state: ${this.state}`);
    }
    this.result = null;
    return this.transition(TASK_STATES.READY);
  }

  /**
   * Cancel a task → Failed (terminal for the current run; may be resumed later).
   */
  cancel() {
    if (![TASK_STATES.EXECUTING, TASK_STATES.WAITING].includes(this.state)) {
      throw new Error(`Cannot cancel from state: ${this.state}`);
    }
    return this.transition(TASK_STATES.FAILED);
  }

  /**
   * Rollback to a previous checkpoint → Ready for re-execution.
   * Returns the restored snapshot or null if none exists.
   */
  rollback(checkpointIndex = -1) {
    const target =
      checkpointIndex >= 0
        ? this.checkpoints[checkpointIndex]
        : this.checkpoints[this.checkpoints.length - 1];
    if (!target) return null;

    // Restore context/artifacts from the snapshot
    this.context = { ...(target.context || {}) };
    this.artifacts = { ...(target.artifacts || {}) };
    this.result = target.result ?? null;
    this.metadata.updatedAt = Date.now();
    return this.transition(TASK_STATES.READY);
  }

  // ─────────────────────────── Data helpers ───────────────────────────

  /** Attach an artifact reference (path/id) to the task context index. */
  attachArtifact(name, ref) {
    this.artifacts[name] = ref;
    return this;
  }

  /** Append a trace entry for observability / replay. */
  addTrace(entry) {
    this.trace.push({ ...entry, timestamp: Date.now() });
    return this;
  }

  /** Save the current state as a checkpoint snapshot (returns index). */
  saveCheckpoint() {
    const snapshot = {
      id: `checkpoint_${this.checkpoints.length + 1}`,
      context: { ...this.context },
      artifacts: { ...this.artifacts },
      result: this.result,
      timestamp: Date.now()
    };
    this.checkpoints.push(snapshot);
    return this.checkpoints.length - 1;
  }

  /** Serialize to a plain JSON object for persistence. */
  toJSON() {
    return {
      id: this.id,
      goal: this.goal,
      state: this.state,
      context: this.context,
      artifacts: this.artifacts,
      checkpoints: this.checkpoints,
      result: this.result,
      trace: this.trace,
      metadata: { ...this.metadata },
      steps: this.steps
    };
  }

  /** Rehydrate a Task from serialized JSON (static factory). */
  static fromJSON(data) {
    return new Task(data);
  }
}

export default Task;
