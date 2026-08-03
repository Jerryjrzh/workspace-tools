import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createToolHarness, expectWorkspace, expectState, expectBackup, expectThrows, runRegressionSuite } from '../../src/runtime/harness.js';
import { GuardStage } from '../../src/runtime/stages/GuardStage.js';

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-harness-'));
  const workspace = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  return { tempDir, workspace };
}

test('harness assertion helpers can validate runtime context', async () => {
  const { tempDir, workspace } = createTempWorkspace();
  const targetFile = path.join(workspace, 'sample.txt');
  fs.writeFileSync(targetFile, 'hello\nworld\n', 'utf8');

  const runner = createToolHarness(async (ctx) => {
    ctx.state = ctx.state || {};
    ctx.state.status = 'ok';
    return { ok: true };
  }, {
    workspace,
    toolName: 'file_patch',
    args: { path: 'sample.txt' },
    stages: [GuardStage],
    assertions: [
      (ctx) => expectWorkspace(ctx, workspace),
      (ctx) => expectState(ctx, 'status', 'ok'),
      (ctx) => expectBackup(ctx, 'sample.txt')
    ]
  });

  await runner();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('expectThrows reports thrown errors', async () => {
  await expectThrows(async () => {
    throw new Error('boom');
  }, /boom/);
});

test('runRegressionSuite covers workspace, session, provider, and guard paths end to end', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-regression-'));
  const workspace = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });

  const targetFile = path.join(workspace, 'sample.txt');
  fs.writeFileSync(targetFile, 'hello\nworld\n', 'utf8');

  const conversationPath = path.join(tempDir, '.lmstudio', 'conversations', 'regression-session.conversation.json');
  fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
  fs.writeFileSync(conversationPath, JSON.stringify({
    name: 'Regression Conversation',
    messages: [{ role: 'user', content: { text: '请修复这个 workspace 问题' } }]
  }), 'utf8');

  const oldHome = process.env.HOME;
  process.env.HOME = tempDir;

  try {
    const ctx = await runRegressionSuite({
      sessionId: 'regression-session',
      workspace,
      toolName: 'file_patch',
      args: { path: 'sample.txt' }
    });

    assert.equal(ctx.state.regression.workspace, workspace);
    assert.equal(ctx.state.regression.sessionId, 'regression-session');
    assert.equal(ctx.state.regression.conversationName, 'Regression Conversation');
    assert.equal(ctx.state.regression.task, 'coding');
    assert.equal(ctx.state.regression.guarded, true);
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
