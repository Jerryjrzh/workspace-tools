import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { WorkspaceStage } from '../../src/runtime/stages/WorkspaceStage.js';
import { ConversationStage } from '../../src/runtime/stages/ConversationStage.js';
import { TaskStage } from '../../src/runtime/stages/TaskStage.js';
import { SummaryStage } from '../../src/runtime/stages/SummaryStage.js';
import { SnapshotStage } from '../../src/runtime/stages/SnapshotStage.js';
import { SessionPersistStage } from '../../src/runtime/stages/SessionPersistStage.js';

function createTempHome() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lifecycle-transitions-'));
  const convDir = path.join(tempHome, '.lmstudio', 'conversations');
  const sessionDir = path.join(tempHome, '.lmstudio', 'sessions');
  fs.mkdirSync(convDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { tempHome, convDir, sessionDir };
}

test('runtime lifecycle tracks session, conversation, and workspace transitions', async () => {
  const { tempHome, convDir } = createTempHome();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  const sessionId = 'transition-test';
  fs.writeFileSync(
    path.join(convDir, `${sessionId}.conversation.json`),
    JSON.stringify({
      name: 'Transition Test',
      messages: [
        { role: 'user', content: { text: '请修复这个 bug' } }
      ]
    }),
    'utf8'
  );

  try {
    const runtime = new AgentRuntime();
    runtime.use(WorkspaceStage);
    runtime.use(ConversationStage);
    runtime.use(TaskStage);
    runtime.use(SummaryStage);
    runtime.use(SnapshotStage);
    runtime.use(SessionPersistStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        workspace: ctx.workspace,
        conversationName: ctx.conversation?.name,
        task: ctx.task,
        summaryText: ctx.session?.summaryText || null
      };
      await next();
    });

    const ctx = await runtime.execute({
      sessionId,
      workspace: '/tmp/first-workspace',
      toolRequest: { name: 'transition_probe', args: {}, conversationId: sessionId }
    });

    assert.equal(ctx.result.workspace, '/tmp/first-workspace');
    assert.equal(ctx.result.conversationName, 'Transition Test');
    assert.equal(ctx.result.task, 'coding');
    assert.ok(ctx.result.summaryText?.includes('修复'));
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
