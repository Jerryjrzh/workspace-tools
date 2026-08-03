import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionStateProvider } from '../../src/runtime/providers/SessionStateProvider.js';

test('SessionStateProvider persists and loads session state', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-session-provider-'));
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const provider = new SessionStateProvider();
    const state = {
      sessionId: 'provider-test',
      workspace: '/tmp/workspace',
      task: 'coding',
      initialized: true,
      updatedAt: new Date().toISOString()
    };

    const statePath = provider.save('provider-test', state);
    assert.ok(fs.existsSync(statePath));

    const loaded = provider.load('provider-test');
    assert.equal(loaded.sessionId, 'provider-test');
    assert.equal(loaded.task, 'coding');
    assert.equal(loaded.workspace, '/tmp/workspace');
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
