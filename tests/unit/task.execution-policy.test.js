import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPolicy } from '../../src/runtime/workflows/ExecutionPolicy.js';
import { WorkflowDefinition } from '../../src/runtime/workflows/WorkflowDefinition.js';
import { PolicyManager } from '../../src/runtime/workflows/PolicyManager.js';
import { WorkflowEngine, STAGE_IMPL } from '../../src/runtime/workflows/WorkflowEngine.js';
import { defaultPipeline } from '../../src/runtime/workflows/index.js';

test('ExecutionPolicy defaults and validation', () => {
  const policy = new ExecutionPolicy();
  assert.equal(policy.retry, 0);
  assert.equal(policy.timeoutMs, 30000);
  assert.equal(policy.maxDepth, 10);
  assert.equal(policy.checkpointFreq, 1);
  assert.equal(policy.autoReview, true);
  policy.validate(); // should not throw

  const bad = new ExecutionPolicy({ retry: -1 });
  assert.throws(() => bad.validate());
});

test('ExecutionPolicy serializes and rehydrates', () => {
  const original = new ExecutionPolicy({ retry: 3, parallel: true });
  const restored = ExecutionPolicy.fromJSON(original.toJSON());
  assert.equal(restored.retry, 3);
  assert.equal(restored.parallel, true);
});

test('WorkflowDefinition validates allowed steps', () => {
  const def = new WorkflowDefinition({
    name: 'review-flow',
    steps: ['planning', 'execution', 'validation', 'review', 'finalize'],
    policy: { retry: 2 }
  });
  assert.equal(def.validate(), true);
  assert.equal(def.policy.retry, 2);

  const bad = new WorkflowDefinition({ name: 'x', steps: ['nope'] });
  assert.throws(() => bad.validate());
});

test('WorkflowDefinition parses minimal YAML', () => {
  const yaml = `
    name: my-workflow
    steps:
      - planning
      - execution
      - validation
      - review
      - finalize
    policy:
      retry: 2
      timeoutMs: 60000
  `;
  const def = WorkflowDefinition.fromYAML(yaml);
  assert.equal(def.name, 'my-workflow');
  assert.deepEqual(
    def.steps.map((s) => s.name),
    ['planning', 'execution', 'validation', 'review', 'finalize']
  );
  assert.equal(def.policy.retry, 2);
  assert.equal(def.policy.timeoutMs, 60000);
});

test('PolicyManager registers and resolves policies/workflows by name', () => {
  const pm = new PolicyManager();
  pm.registerPolicy('strict', { retry: 0 });
  pm.registerWorkflow('review-flow', {
    name: 'review-flow',
    steps: ['planning', 'execution'],
    policy: { retry: 1 }
  });

  assert.equal(pm.getPolicy('strict').retry, 0);
  const wf = pm.getWorkflow('review-flow');
  assert.ok(wf instanceof WorkflowDefinition);
  assert.equal(wf.steps.length, 2);

  // unknown names return null
  assert.equal(pm.getPolicy('missing'), null);
  assert.equal(pm.getWorkflow('missing'), null);
});

test('WorkflowEngine resolves a definition into ordered stage functions', () => {
  const engine = new WorkflowEngine();
  const def = new WorkflowDefinition({
    name: 'full',
    steps: ['planning', 'execution', 'validation', 'review', 'finalize']
  });

  const stages = engine.build(def);
  assert.equal(stages.length, 5);
  // Each resolved stage is one of the known implementations
  for (const stage of stages) {
    assert.ok(Object.values(STAGE_IMPL).includes(stage));
  }
});

test('WorkflowEngine rejects unknown stages', () => {
  const engine = new WorkflowEngine();
  assert.throws(() => engine.resolveSteps(['planning', 'bogus']));
});

test('defaultPipeline returns the full ordered pipeline', () => {
  const stages = defaultPipeline();
  assert.equal(stages.length, 5);
});
