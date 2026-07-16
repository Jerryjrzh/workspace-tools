import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { applyRuntimeFramework, runtimeFramework } from '../../src/runtime/framework.js';

const stageNames = runtimeFramework.stages.map((stage) => stage.name);

test('runtime framework exposes the expected ordered stages', () => {
  assert.deepEqual(stageNames.slice(0, 4), [
    'WorkspaceStage',
    'RuntimeContextStage',
    'SessionRecoveryStage',
    'WorkspacePolicyStage'
  ]);
  assert.ok(stageNames.includes('MemoryStage'));
  assert.ok(stageNames.includes('PlannerStage'));
});

test('applyRuntimeFramework registers the shared framework stages in order', async () => {
  const runtime = new AgentRuntime();
  applyRuntimeFramework(runtime);

  assert.equal(runtime.stages.length, runtimeFramework.stages.length);
  assert.equal(runtime.stages[0].name, 'WorkspaceStage');
  assert.equal(runtime.stages[runtime.stages.length - 1].name, 'GuardStage');
});
