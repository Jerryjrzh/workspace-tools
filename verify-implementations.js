// verify-implementations.js
// 一键验证 NEXT_STEPS_v3 四个阶段实施的功能（Phase 3/6/4/5）
//
// 运行方式：node verify-implementations.js
// 期望输出：全部 ✅ PASS，0 ❌ FAIL

import os from 'os';
import path from 'path';
import fs from 'fs';

const results = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    results.push(true);
  } catch (error) {
    console.log(`  ❌ ${name}: ${error.message}`);
    results.push(false);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    results.push(true);
  } catch (error) {
    console.log(`  ❌ ${name}: ${error.message}`);
    results.push(false);
  }
}

const rt = await import('./src/runtime/index.js');

console.log('=== Phase 3: Workflow Engine ===');
check('Task 状态机：happy path', () => {
  const task = new rt.Task({ goal: 'g' });
  task.plan().ready().execute().review().complete('done').archive();
  if (task.getState() !== rt.TASK_STATES.ARCHIVED) throw new Error('state wrong');
});

await checkAsync('TaskManager + CheckpointManager 持久化', async () => {
  const baseDir = path.join(os.tmpdir(), `verify_t3_${Date.now()}`);
  try {
    const manager = new rt.TaskManager({ baseDir });
    const ckpts = new rt.CheckpointManager(manager);
    const task = manager.create({ goal: 'persist' });
    task.context.file = '/a';
    manager.update(task);
    ckpts.save(task.id);
    // 从新 manager（无缓存）读取，证明持久化
    const reloaded = new rt.TaskManager({ baseDir }).load(task.id);
    if (!reloaded) throw new Error('not persisted');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

await checkAsync('WorkflowDefinition YAML + WorkflowEngine', async () => {
  const def = rt.WorkflowDefinition.fromYAML(`
    name: flow
    steps:
      - planning
      - execution
      - validation
      - review
      - finalize
    policy:
      retry: 2
  `);
  if (def.policy.retry !== 2) throw new Error('yaml parse failed');
  const stages = new rt.WorkflowEngine().build(def);
  if (stages.length !== 5) throw new Error('stage count wrong');
});

console.log('\n=== Phase 6: Observability ===');
await checkAsync('Trace + Timeline + Metrics', async () => {
  const obs = new rt.ObservabilityManager();
  const trace = obs.trace.start({ traceId: 't1', name: 'request' });
  obs.trace.end({ traceId: 't1', spanId: trace.spanId });
  if (obs.trace.getSpans('t1').length !== 1) throw new Error('no spans');

  obs.metrics.record({ traceId: 'm1', name: 'latency', value: 10 });
  const snap = obs.snapshot();
  if (snap.latencyMs.count !== 1) throw new Error('metrics wrong');
});

await checkAsync('ExecutionRecorder 完整执行链', async () => {
  const recorder = new rt.ExecutionRecorder();
  const chain = recorder.recordFromContext({
    sessionId: 's',
    task: { id: 't', artifacts: {} },
    conversation: { messages: [] },
    rules: [],
    memory: { entries: [] },
    executionPlan: null,
    toolRequest: { name: 'probe' },
    result: { ok: true },
    validation: { ok: true }
  });
  const stages = chain.map((e) => e.stage);
  if (!stages.includes('prompt') || !stages.includes('tool')) throw new Error('chain incomplete');
});

console.log('\n=== Phase 4: Artifact Workspace ===');
await checkAsync('ArtifactManager + Version', async () => {
  const baseDir = path.join(os.tmpdir(), `verify_t4_${Date.now()}`);
  try {
    const manager = new rt.ArtifactManager({ baseDir });
    const art = manager.create({ name: 'analysis.md', content: 'v1' });
    manager.update(art.id, 'v2');
    if (manager.getHistory(art.id).length !== 2) throw new Error('no version history');
    // rollback
    manager.rollback(art.id, 1);
    const reloaded = manager.read(art.id);
    if (reloaded.content !== 'v1') throw new Error('rollback failed');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

await checkAsync('DependencyGraph + IncrementalReview', async () => {
  const graph = new rt.DependencyGraph();
  graph.addDependency('review.md', 'analysis.md');
  graph.addDependency('analysis.md', 'source.cpp');

  const review = new rt.IncrementalReview({ graph });
  review.registerSource('analysis.md', ['src/analysis.js']);

  const result = review.review({ modifiedFiles: ['src/analysis.js'] });
  if (!result.scope.affected.includes('review.md')) throw new Error('impact analysis failed');
});

await checkAsync('KnowledgeProvider（抽象接口 + 内存实现）', async () => {
  // 抽象接口应抛错
  const abstract = new rt.KnowledgeProvider();
  let threw = false;
  try { abstract.indexTags({ id: 'x' }); } catch { threw = true; }
  if (!threw) throw new Error('abstract should throw');

  // 内存实现可用
  const mem = new rt.MemoryKnowledgeProvider();
  mem.indexTags({ id: 'a.md', tags: ['review'] });
  if (mem.queryByTag('review').length !== 1) throw new Error('tag query failed');
});

console.log('\n=== Phase 5: Multi-Agent ===');
await checkAsync('Coordinator + Consensus 端到端', async () => {
  const manager = new rt.MultiAgentManager({
    agents: { planner: new rt.PlannerAgent(), reviewer: new rt.ReviewerAgent() },
    weights: { reviewer: 2 }
  });
  const outcome = await manager.run(
    { goal: 'g', task: { artifacts: {} }, result: null, validation: { ok: true } },
    ['planner', 'reviewer']
  );
  if (!outcome.dispatch.results.planner) throw new Error('dispatch failed');
  if (typeof outcome.consensus.decision !== 'string') throw new Error('no consensus');
});

console.log('\n=== 汇总 ===');
const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\n${passed}/${total} 项通过`);
if (passed === total) {
  console.log('🎉 全部功能验证通过！');
} else {
  console.log(`⚠️ ${total - passed} 项失败`);
}
process.exit(passed === total ? 0 : 1);
