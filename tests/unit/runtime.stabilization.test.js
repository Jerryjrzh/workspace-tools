import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../../src/runtime/policies/PolicyEngine.js';
import { ProviderRegistry } from '../../src/runtime/providers/ProviderRegistry.js';
import { RuntimeContextStage } from '../../src/runtime/stages/RuntimeContextStage.js';

test('PolicyEngine executes policies in order and supports custom middleware', async () => {
  const calls = [];
  const engine = new PolicyEngine([
    async (ctx, next) => {
      calls.push('first');
      return next();
    },
    async (ctx, next) => {
      calls.push('second');
      return next();
    }
  ]);

  await engine.run({}, async () => {
    calls.push('done');
  });

  assert.deepEqual(calls, ['first', 'second', 'done']);
});

test('RuntimeContextStage resolves conversation and workspace from provider registry', async () => {
  const registry = new ProviderRegistry({
    conversation: {
      load: () => ({ name: 'Injected Conversation', messages: [] })
    },
    workspace: {
      getWorkspaceForSession: () => '/tmp/injected-workspace'
    }
  });

  const ctx = {
    sessionId: 'registry-test',
    providerRegistry: registry
  };

  await RuntimeContextStage(ctx, async () => {});

  assert.equal(ctx.conversation.name, 'Injected Conversation');
  assert.equal(ctx.workspace, '/tmp/injected-workspace');
});
