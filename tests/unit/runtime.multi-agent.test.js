import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../../src/runtime/agents/Agent.js';
import { Coordinator } from '../../src/runtime/agents/Coordinator.js';
import { PlannerAgent } from '../../src/runtime/agents/PlannerAgent.js';
import { ExecutorAgent } from '../../src/runtime/agents/ExecutorAgent.js';
import { ReviewerAgent } from '../../src/runtime/agents/ReviewerAgent.js';
import { MemoryAgent } from '../../src/runtime/agents/MemoryAgent.js';
import { ReflectionAgent } from '../../src/runtime/agents/ReflectionAgent.js';
import { Consensus } from '../../src/runtime/agents/Consensus.js';
import { MultiAgentManager } from '../../src/runtime/agents/MultiAgentManager.js';

test('Agent base class requires execute implementation', async () => {
  const agent = new Agent({ role: 'general' });
  await assert.rejects(() => agent.run({}));
});

test('PlannerAgent produces a plan with steps', async () => {
  const planner = new PlannerAgent();
  const result = await planner.run({
    goal: 'review the codebase',
    workflowDefinition: { steps: ['planning', 'execution'] }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.output.steps.map((s) => s.name),
    ['planning', 'execution']
  );
});

test('ExecutorAgent executes a tool and captures failures', async () => {
  const executor = new ExecutorAgent();
  // unknown tool → captured failure (not thrown)
  const failResult = await executor.run({
    toolRequest: { name: 'no_such_tool', args: {} }
  });
  assert.equal(failResult.ok, false);
});

test('ReviewerAgent produces verdict + findings', async () => {
  const reviewer = new ReviewerAgent();
  // failing validation → fail verdict
  const bad = await reviewer.run({
    task: { artifacts: {} },
    result: null,
    validation: { ok: false }
  });
  assert.equal(bad.output.verdict, 'fail');

  // passing case → pass verdict with warn about no artifacts
  const good = await reviewer.run({
    task: { artifacts: { planning: '/p.md' } },
    result: { ok: true },
    validation: { ok: true }
  });
  assert.equal(good.output.verdict, 'pass');
});

test('ReflectionAgent reflects on failures in trace', async () => {
  const reflection = new ReflectionAgent();
  const result = await reflection.run({
    task: {
      trace: [{ stage: 'tool', ok: false }],
      artifacts: {}
    },
    result: { ok: false }
  });
  assert.equal(result.ok, true);
  assert.ok(
    result.output.reflections.some((r) => r.type === 'failure')
  );
});

test('Coordinator dispatches roles in parallel and aggregates results', async () => {
  const coordinator = new Coordinator({
    agents: {
      planner: new PlannerAgent(),
      reviewer: new ReviewerAgent()
    }
  });

  const ctx = {
    goal: 'g',
    task: { artifacts: {} },
    result: null,
    validation: { ok: true }
  };

  const dispatch = await coordinator.dispatch(ctx, ['planner', 'reviewer']);
  assert.equal(dispatch.ok, true);
  assert.ok(dispatch.results.planner.output.steps.length > 0);
});

test('Coordinator returns failure when no agents registered for roles', async () => {
  const coordinator = new Coordinator({ agents: {} });
  const dispatch = await coordinator.dispatch({}, ['missing']);
  assert.equal(dispatch.ok, false);
});

test('Consensus decides majority vote with confidence', () => {
  const consensus = new Consensus();
  // two pass, one fail → pass
  const decision = consensus.decide([
    { role: 'reviewer', ok: true },
    { role: 'planner', ok: true },
    { role: 'executor', ok: false }
  ]);
  assert.equal(decision.decision, 'pass');
  assert.ok(decision.confidence > 0.5);
});

test('Consensus supports weighted voting', () => {
  const consensus = new Consensus({ weights: { reviewer: 3 } });
  // one fail (weighted 1) vs one pass (reviewer weight 3) → pass
  const decision = consensus.decide([
    { role: 'executor', ok: false },
    { role: 'reviewer', ok: true }
  ]);
  assert.equal(decision.decision, 'pass');
});

test('MultiAgentManager runs dispatch + consensus end-to-end', async () => {
  const manager = new MultiAgentManager({
    agents: {
      planner: new PlannerAgent(),
      reviewer: new ReviewerAgent()
    },
    weights: { reviewer: 2 }
  });

  const ctx = {
    goal: 'g',
    task: { artifacts: {} },
    result: null,
    validation: { ok: true }
  };

  const outcome = await manager.run(ctx, ['planner', 'reviewer']);
  assert.ok(outcome.dispatch.results.planner);
  assert.equal(typeof outcome.consensus.decision, 'string');
});
