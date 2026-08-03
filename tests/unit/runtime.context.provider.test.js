import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeContextProvider } from '../../src/runtime/providers/RuntimeContextProvider.js';
import { workspaceManager } from '../../src/managers/workspace.js';

function createTempEnvironment() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-context-provider-'));
  const convDir = path.join(tempHome, '.lmstudio', 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  return { tempHome, convDir };
}

test('RuntimeContextProvider resolves conversation and workspace through providers', async () => {
  const { tempHome, convDir } = createTempEnvironment();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  const sessionId = 'context-provider-test';
  const workspacePath = path.join(tempHome, 'workspace');
  fs.mkdirSync(workspacePath, { recursive: true });

  fs.writeFileSync(
    path.join(convDir, `${sessionId}.conversation.json`),
    JSON.stringify({ name: 'Context Provider Test', messages: [{ role: 'user', content: { text: '请处理这个上下文' } }] }),
    'utf8'
  );

  try {
    workspaceManager.setSessionWorkspace(sessionId, workspacePath);

    const provider = new RuntimeContextProvider();
    const resolved = provider.resolve(sessionId, '/tmp/fallback-workspace');

    assert.equal(resolved.conversation.name, 'Context Provider Test');
    assert.equal(resolved.workspace, '/tmp/fallback-workspace');
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
