import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionPersistenceProvider } from '../../src/runtime/providers/SessionPersistenceProvider.js';

test('SessionPersistenceProvider stores conversation, session state, and snapshot through one interface', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-persistence-provider-'));
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const provider = new SessionPersistenceProvider();
    const sessionId = 'persistence-test';

    const conversation = {
      name: 'Persistence Test',
      messages: [{ role: 'user', content: { text: '请保存这个会话' } }]
    };

    const state = {
      sessionId,
      workspace: '/tmp/workspace',
      task: 'coding',
      initialized: true
    };

    const snapshot = {
      kind: 'conversation',
      task: 'coding',
      turnCount: 1
    };

    provider.saveConversation(sessionId, conversation);
    provider.saveSessionState(sessionId, state);
    provider.saveSnapshot(sessionId, snapshot);

    assert.deepEqual(provider.loadConversation(sessionId), conversation);
    assert.deepEqual(provider.loadSessionState(sessionId), state);
    assert.deepEqual(provider.loadSnapshot(sessionId), snapshot);

    assert.ok(fs.existsSync(path.join(tempHome, '.lmstudio', 'conversations', `${sessionId}.conversation.json`)));
    assert.ok(fs.existsSync(path.join(tempHome, '.lmstudio', 'sessions', `${sessionId}.json`)));
    assert.ok(fs.existsSync(path.join(tempHome, '.lmstudio', 'snapshots', `${sessionId}.snapshot.json`)));
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
