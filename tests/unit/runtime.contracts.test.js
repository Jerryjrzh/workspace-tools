import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime, RuntimeContext } from '../../src/runtime/AgentRuntime.js';
import { EventBus, DOMAIN_EVENTS } from '../../src/runtime/EventBus.js';
import { PluginRegistry } from '../../src/runtime/plugins/PluginRegistry.js';
import { toToolResult, normalizeToolResult } from '../../src/runtime/ToolResult.js';
import { Provider } from '../../src/runtime/providers/Provider.js';
import { detectCapabilities } from '../../src/runtime/capabilities.js';

test('RuntimeContext exposes the formal contract fields', () => {
  const ctx = RuntimeContext.create({
    sessionId: 's1',
    toolRequest: { name: 'file_read', args: {}, conversationId: 's1' },
    workspace: '/tmp/ws'
  });

  assert.equal(ctx.sessionId, 's1');
  assert.equal(ctx.workspace, '/tmp/ws');
  assert.deepEqual(ctx.toolRequest.name, 'file_read');
  assert.ok(Array.isArray(ctx.rules));
  assert.ok(Array.isArray(ctx.skills));
  assert.ok(ctx.memory && Array.isArray(ctx.memory.entries));
  // lifecycle bookkeeping present
  assert.equal(ctx.lifecycle.initialized, false);
});

test('AgentRuntime runs the full lifecycle contract', async () => {
  const events = [];
  const runtime = new AgentRuntime({
    hooks: {
      initialize: (ctx) => { ctx.runtimeState.booted = true; },
      persist: (ctx) => { ctx.lifecycle.persisted = true; }
    }
  });
  runtime.use(async (ctx, next) => {
    events.push('stage');
    await next();
  });

  const ctx = await runtime.execute({ sessionId: 'life', toolRequest: { name: 'probe' } });

  assert.equal(ctx.runtimeState.booted, true);
  assert.equal(ctx.lifecycle.persisted, true);
  assert.equal(ctx.lifecycle.cleanedUp, true);
  assert.ok(events.includes('stage'));
});

test('EventBus emits structured domain events to observers', () => {
  const bus = new EventBus();
  let received = null;
  const unsubscribe = bus.onDomain(DOMAIN_EVENTS.BeforeTool, (payload) => {
    received = payload;
  });

  bus.beforeTool({ tool: 'file_read' });
  assert.equal(received.tool, 'file_read');
  assert.ok(received.eventName === DOMAIN_EVENTS.BeforeTool);
  assert.ok(typeof received.timestamp === 'number');

  unsubscribe();
  received = null;
  bus.beforeTool({ tool: 'x' });
  assert.equal(received, null); // unsubscribed
});

test('PluginRegistry registers tools/stages/policies and lists plugins', async () => {
  const registry = new PluginRegistry();

  await registry.register({
    name: 'my-plugin',
    version: '1.0.0',
    register(r) {
      r.registerTool('custom_tool', async () => ({ ok: true }));
      r.registerStage(async (ctx, next) => { ctx.state.plugined = true; return next(); });
      r.registerPolicy({ name: 'custom-policy' });
    }
  });

  assert.deepEqual(registry.listPlugins().map((p) => p.name), ['my-plugin']);
  assert.ok(registry.getToolExtensions()['custom_tool']);
  assert.equal(registry.getStageExtensions().length, 1);
  assert.equal(registry.extensions.policies.length, 1);

  // duplicate registration is idempotent
  const again = await registry.register({ name: 'my-plugin', version: '1.0.0', register() {} });
  assert.equal(again, false);
});

test('ToolResult normalizes raw outputs into the canonical contract', () => {
  const str = toToolResult('hello');
  assert.deepEqual(str.type, 'string');

  const obj = normalizeToolResult({ status: 'OK' }, { tool: 'memory_search' });
  assert.equal(obj.ok, true);
  assert.equal(obj.type, 'json');
  assert.equal(obj.meta.tool, 'memory_search');

  // already-structured results pass through unchanged
  const structured = { ok: true, data: [1], type: 'json', meta: {} };
  assert.deepEqual(normalizeToolResult(structured), structured);
});

test('Provider base class supports watch/dispose lifecycle', async () => {
  class FakeProvider extends Provider {
    async load() { return null; }
    async save(sessionId, data) { this.notifyChange(sessionId, { kind: 'fake' }); return true; }
  }

  const provider = new FakeProvider();
  let notified = false;
  const unsubscribe = provider.watch('s1', (payload) => {
    if (payload.kind === 'fake') notified = true;
  });

  await provider.save('s1', {});
  assert.equal(notified, true);

  unsubscribe();
  notified = false;
  await provider.save('s1', {});
  assert.equal(notified, false); // unsubscribed

  await provider.dispose();
  assert.equal(provider.disposed, true);
});

test('capability detection reports available system binaries', () => {
  const caps = detectCapabilities('/tmp');
  assert.ok(typeof caps.shell === 'boolean');
  assert.ok(typeof caps.git === 'boolean');
  // node is guaranteed present in this test environment
  assert.equal(caps.node, true);
});
