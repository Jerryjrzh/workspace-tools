import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, DOMAIN_EVENTS } from '../../src/runtime/EventBus.js';
import { Trace } from '../../src/runtime/observability/Trace.js';
import { Timeline } from '../../src/runtime/observability/Timeline.js';
import { Metrics } from '../../src/runtime/observability/Metrics.js';
import { ExecutionRecorder } from '../../src/runtime/observability/ExecutionRecorder.js';
import { ObservabilityManager } from '../../src/runtime/observability/ObservabilityManager.js';

test('Trace opens/closes spans with parent linkage and duration', () => {
  const trace = new Trace();
  const request = trace.start({ traceId: 't1', name: 'request', kind: 'request' });
  const stage = trace.start({
    traceId: 't1',
    name: 'planning',
    kind: 'stage',
    parentSpanId: request.spanId
  });

  assert.equal(stage.parentSpanId, request.spanId);

  // close inner then outer (LIFO)
  const closedStage = trace.end({ traceId: 't1', spanId: stage.spanId });
  assert.ok(closedStage.durationMs >= 0);
  assert.equal(closedStage.status, 'ok');

  const closedRequest = trace.end({ traceId: 't1' }); // closes top (request)
  assert.equal(closedRequest.name, 'request');
  assert.equal(trace.getSpans('t1').length, 2);
});

test('Trace withSpan auto-closes and captures errors', async () => {
  const trace = new Trace();
  const { result } = await trace.withSpan(
    { traceId: 't2', name: 'tool' },
    async () => ({ ok: true })
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(trace.getSpans('t2')[0].status, 'ok');

  // error path
  await assert.rejects(
    trace.withSpan({ traceId: 't3', name: 'tool' }, async () => {
      throw new Error('boom');
    })
  );
  const spans = trace.getSpans('t3');
  assert.equal(spans[0].status, 'error');
});

test('Trace emits TraceSpan domain events to observers', () => {
  const bus = new EventBus();
  let received = null;
  bus.onDomain(DOMAIN_EVENTS.TraceSpan, (p) => { received = p; });

  const trace = new Trace({ eventBus: bus });
  const span = trace.start({ traceId: 't4', name: 'stage' });
  trace.end({ traceId: 't4', spanId: span.spanId });

  assert.ok(received);
  assert.equal(received.eventName, DOMAIN_EVENTS.TraceSpan);
  assert.equal(received.traceId, 't4');
});

test('Timeline records ordered phase events', () => {
  const timeline = new Timeline();
  timeline.record({ traceId: 'tl1', phase: 'planning' });
  timeline.record({ traceId: 'tl1', phase: 'search' });
  timeline.record({ traceId: 'tl1', phase: 'review' });

  const entries = timeline.getEntries('tl1');
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.phase),
    ['planning', 'search', 'review']
  );
});

test('Timeline withPhase records start and end markers', async () => {
  const timeline = new Timeline();
  await timeline.withPhase({ traceId: 'tl2', phase: 'report' }, async () => ({ ok: true }));
  const entries = timeline.getEntries('tl2');
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.phase),
    ['report', 'report:end']
  );
});

test('Metrics aggregates latency/toolTime/memoryHit/retry/failure/confidence', () => {
  const metrics = new Metrics();
  metrics.record({ traceId: 'm1', name: 'latency', value: 10 });
  metrics.record({ traceId: 'm1', name: 'latency', value: 30 });
  metrics.record({ traceId: 'm1', name: 'toolTime', value: 5 });
  metrics.record({ traceId: 'm1', name: 'memoryHit', value: true });
  metrics.record({ traceId: 'm1', name: 'retry' });
  metrics.record({ traceId: 'm1', name: 'failure', value: true });

  const snap = metrics.snapshot();
  assert.equal(snap.latencyMs.count, 2);
  assert.equal(snap.latencyMs.min, 10);
  assert.equal(snap.latencyMs.max, 30);
  assert.equal(snap.toolTimeMs.avg, 5);
  assert.equal(snap.memoryHits, 1);
  assert.equal(snap.retries, 1);
  assert.equal(snap.failures, 1);
});

test('ExecutionRecorder captures the full chain from a context', () => {
  const recorder = new ExecutionRecorder();
  const ctx = {
    sessionId: 's1',
    task: { id: 'task_1', artifacts: { planning: '/p.md' } },
    conversation: { messages: [{ role: 'user', content: { text: 'hello' } }] },
    rules: ['r1'],
    memory: { entries: [] },
    executionPlan: { strategy: 'workflow' },
    toolRequest: { name: 'file_read', args: { path: '/a' } },
    result: { ok: true, data: 'x' },
    validation: { ok: true }
  };

  const chain = recorder.recordFromContext(ctx);
  const stages = chain.map((e) => e.stage);
  assert.deepEqual(stages, ['prompt', 'context', 'planner', 'tool', 'artifact', 'response']);

  // tool entry captures input+output
  const toolEntry = chain.find((e) => e.stage === 'tool');
  assert.equal(toolEntry.input.name, 'file_read');
  assert.deepEqual(toolEntry.output, { ok: true, data: 'x' });
});

test('ObservabilityManager records a full request lifecycle', () => {
  const bus = new EventBus();
  const obs = new ObservabilityManager({ eventBus: bus });

  let traceEvents = 0;
  bus.onDomain(DOMAIN_EVENTS.TraceSpan, () => { traceEvents += 1; });

  const ctx = {
    sessionId: 's2',
    task: { id: 'task_2', artifacts: {} },
    conversation: { messages: [] },
    rules: [],
    memory: { entries: [] },
    executionPlan: null,
    toolRequest: { name: 'probe' },
    result: { ok: true },
    validation: { ok: true },
    lifecycle: { startedAt: Date.now() - 5 },
    timestamp: Date.now(),
    state: {}
  };

  const chain = obs.recordRequest(ctx);
  assert.ok(chain.length >= 4); // prompt/context/planner/tool/response
  assert.equal(traceEvents, 1);

  const snap = obs.snapshot();
  assert.equal(snap.latencyMs.count, 1);
});
