import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Task, TASK_STATES } from '../../src/runtime/tasks/Task.js';
import { TaskManager } from '../../src/runtime/tasks/TaskManager.js';
import { CheckpointManager } from '../../src/runtime/tasks/CheckpointManager.js';

test('Task starts in Created with default fields', () => {
  const task = new Task({ goal: 'build workflow' });
  assert.equal(task.getState(), TASK_STATES.CREATED);
  assert.ok(task.id.startsWith('task_'));
  assert.deepEqual(task.artifacts, {});
  assert.deepEqual(task.checkpoints, []);
  assert.equal(task.result, null);
  assert.deepEqual(task.trace, []);
});

test('Task exposes metadata fields for Planner/Review/Trace reuse', () => {
  const task = new Task({
    goal: 'g',
    priority: 2,
    owner: 'alice',
    capabilities: ['file_read'],
    labels: { area: 'runtime' },
    confidence: 0.8
  });
  assert.equal(task.metadata.priority, 2);
  assert.equal(task.metadata.owner, 'alice');
  assert.deepEqual(task.metadata.capabilities, ['file_read']);
  assert.equal(task.metadata.labels.area, 'runtime');
  assert.equal(task.metadata.confidence, 0.8);
});

test('Task follows the happy-path state machine', () => {
  const task = new Task({ goal: 'g' });
  task.plan();
  assert.equal(task.getState(), TASK_STATES.PLANNING);

  task.ready();
  assert.equal(task.getState(), TASK_STATES.READY);

  task.execute();
  assert.equal(task.getState(), TASK_STATES.EXECUTING);

  task.review();
  assert.equal(task.getState(), TASK_STATES.REVIEWING);

  task.complete('done');
  assert.equal(task.getState(), TASK_STATES.COMPLETED);
  assert.equal(task.result, 'done');

  task.archive();
  assert.equal(task.getState(), TASK_STATES.ARCHIVED);
});

test('Task supports waiting and resuming', () => {
  const task = new Task({ goal: 'g' });
  task.plan().ready().execute();
  task.wait();
  assert.equal(task.getState(), TASK_STATES.WAITING);

  task.resume();
  assert.equal(task.getState(), TASK_STATES.EXECUTING);
});

test('Task supports retry / cancel on failure paths', () => {
  const task = new Task({ goal: 'g' });
  task.plan().ready().execute();

  // fail → retry
  task.fail(new Error('boom'));
  assert.equal(task.getState(), TASK_STATES.FAILED);
  assert.equal(task.result.ok, false);
  assert.ok(task.result.error instanceof Error);

  task.retry();
  assert.equal(task.getState(), TASK_STATES.READY);

  // execute → cancel (also lands in Failed)
  task.execute().cancel();
  assert.equal(task.getState(), TASK_STATES.FAILED);
});

test('Task rollback restores a saved checkpoint and returns to Ready', () => {
  const task = new Task({ goal: 'g' });
  task.context.file = '/a';
  task.plan().ready();

  // save snapshot, mutate context
  const idx = task.saveCheckpoint();
  assert.equal(idx, 0);
  task.context.file = '/b';

  task.execute().fail(new Error('bad'));
  const restored = task.rollback(0);
  assert.ok(restored);
  assert.equal(task.getState(), TASK_STATES.READY);
  assert.equal(task.context.file, '/a');
});

test('Task rejects invalid transitions', () => {
  const task = new Task({ goal: 'g' });
  // Cannot archive before completing
  assert.throws(() => task.archive());
  // Cannot execute from Created (must plan first)
  assert.throws(() => task.execute());
});

test('Task emits state:change events on transition', () => {
  const task = new Task({ goal: 'g' });
  let seen = null;
  task.on('state:change', (e) => { seen = e; });

  task.plan();
  assert.equal(seen.from, TASK_STATES.CREATED);
  assert.equal(seen.to, TASK_STATES.PLANNING);
  assert.equal(seen.taskId, task.id);
});

test('Task serializes and rehydrates via toJSON/fromJSON', () => {
  const original = new Task({
    goal: 'g',
    context: { file: '/x' },
    steps: [{ index: 0, text: 'step', status: 'done' }]
  });
  original.attachArtifact('planning.md', 'art/1');
  original.addTrace({ stage: 'PlanningStage' });

  const json = original.toJSON();
  const restored = Task.fromJSON(json);

  assert.equal(restored.id, original.id);
  assert.deepEqual(restored.context, { file: '/x' });
  assert.equal(restored.artifacts['planning.md'], 'art/1');
  assert.equal(restored.trace.length, 1);
  assert.equal(restored.steps[0].status, 'done');
});

test('TaskManager creates/persists/loads tasks via repository', () => {
  const baseDir = path.join(os.tmpdir(), `taskmgr_${Date.now()}`);
  const manager = new TaskManager({ baseDir });

  try {
    const task = manager.create({ goal: 'persist me' });
    assert.ok(task.id);

    // Reload from a fresh manager (no cache) to prove persistence
    const reloaded = new TaskManager({ baseDir }).load(task.id);
    assert.ok(reloaded);
    assert.equal(reloaded.goal, 'persist me');

    // list returns the task
    const listed = manager.list('all');
    assert.equal(listed.length, 1);

    // delete removes it
    assert.equal(manager.delete(task.id), true);
    assert.equal(new TaskManager({ baseDir }).load(task.id), null);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('CheckpointManager saves/restores/rollbacks/resumes', () => {
  const baseDir = path.join(os.tmpdir(), `ckpt_${Date.now()}`);
  const manager = new TaskManager({ baseDir });
  const ckpts = new CheckpointManager(manager);

  try {
    const task = manager.create({ goal: 'g' });
    task.context.file = '/a';
    manager.update(task);

    // save checkpoint, mutate
    assert.equal(ckpts.save(task.id), 0);
    task.context.file = '/b';
    manager.update(task);

    // restore returns snapshot without mutating state
    const snap = ckpts.restore(task.id);
    assert.ok(snap);
    assert.equal(snap.context.file, '/a');

    // rollback actually resets context and persists
    assert.equal(ckpts.rollback(task.id), true);
    const reloaded = manager.load(task.id);
    assert.equal(reloaded.context.file, '/a');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
