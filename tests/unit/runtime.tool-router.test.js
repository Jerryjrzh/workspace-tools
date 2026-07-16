import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, getToolHandler } from '../../src/runtime/toolRouter.js';

test('tool router exposes handlers for migrated tool families', () => {
  assert.equal(typeof getToolHandler('file_read'), 'function');
  assert.equal(typeof getToolHandler('workspace_set'), 'function');
  assert.equal(typeof getToolHandler('memory_remember'), 'function');
});

test('tool router can execute memory tool handlers', async () => {
  const result = await executeTool('memory_search', { query: 'test', limit: 1 }, {
    sessionId: 'tool-router-test'
  });

  assert.equal(result.status, 'OK');
});
