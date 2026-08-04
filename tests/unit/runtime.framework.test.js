import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { applyRuntimeFramework, runtimeFramework } from '../../src/runtime/framework.js';

const stageNames = runtimeFramework.stages.map((stage) => stage.name);

test('runtime framework exposes the expected ordered stages', () => {
  // ContextBudgetStage 位于 RuntimeContextStage 之后（conversation 加载完成后），
  // 才能读到真实消息并抑制上下文增长。
  assert.deepEqual(stageNames.slice(0, 4), [
    'WorkspaceStage',
    'RuntimeContextStage',
    'ContextBudgetStage',
    'SessionRecoveryStage'
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
