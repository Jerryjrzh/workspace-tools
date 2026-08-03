import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { WorkspaceStage } from '../../src/runtime/stages/WorkspaceStage.js';
import { SessionStage } from '../../src/runtime/stages/SessionStage.js';

function createTempConversationDir() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-session-'));
  const convDir = path.join(tempHome, '.lmstudio', 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  return { tempHome, convDir };
}

test('SessionStage populates runtime context from conversation lifecycle', async () => {
  const { tempHome, convDir } = createTempConversationDir();
  const convId = 'session-stage-test';
  const conversationFile = path.join(convDir, `${convId}.conversation.json`);
  fs.writeFileSync(
    conversationFile,
    JSON.stringify({
      name: 'Session Test',
      messages: [
        { role: 'user', content: { text: '请修复这个 bug' } }
      ]
    }),
    'utf8'
  );

  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const runtime = new AgentRuntime();
    runtime.use(WorkspaceStage);
    runtime.use(SessionStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        sessionId: ctx.session?.id,
        workspace: ctx.workspace,
        task: ctx.task,
        conversationName: ctx.conversation?.name
      };
      await next();
    });

    const ctx = await runtime.execute({
      sessionId: convId,
      toolRequest: {
        name: 'session_probe',
        args: {},
        conversationId: convId
      },
      workspace: '/tmp/placeholder-workspace'
    });

    assert.equal(ctx.result.sessionId, convId);
    assert.equal(ctx.result.task, 'coding');
    assert.equal(ctx.result.conversationName, 'Session Test');
    assert.equal(ctx.session.workspace, '/tmp/placeholder-workspace');
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
