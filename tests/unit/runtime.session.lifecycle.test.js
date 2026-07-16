import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { WorkspaceStage } from '../../src/runtime/stages/WorkspaceStage.js';
import { SessionRecoveryStage } from '../../src/runtime/stages/SessionRecoveryStage.js';
import { RuntimeContextStage } from '../../src/runtime/stages/RuntimeContextStage.js';
import { SessionWorkspaceProvider } from '../../src/runtime/providers/SessionWorkspaceProvider.js';

function createTempEnvironment() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-session-isolation-'));
  const workspaceA = path.join(tempHome, 'workspace-a');
  const workspaceB = path.join(tempHome, 'workspace-b');
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  return { tempHome, workspaceA, workspaceB };
}

test('workspace and session recovery remain session-scoped', async () => {
  const { tempHome, workspaceA, workspaceB } = createTempEnvironment();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const sessionWorkspaceProvider = new SessionWorkspaceProvider();
    sessionWorkspaceProvider.set('session-a', workspaceA);
    sessionWorkspaceProvider.set('session-b', workspaceB);

    const runtime = new AgentRuntime();
    runtime.use(WorkspaceStage);
    runtime.use(RuntimeContextStage);
    runtime.use(SessionRecoveryStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        workspace: ctx.workspace,
        workspaceSource: ctx.session?.workspaceSource,
        sessionWorkspace: ctx.session?.workspace,
        recovery: ctx.session?.recovery || null
      };
      await next();
    });

    const ctxA = await runtime.execute({
      sessionId: 'session-a',
      toolRequest: { name: 'probe', args: {}, conversationId: 'session-a' }
    });
    const ctxB = await runtime.execute({
      sessionId: 'session-b',
      toolRequest: { name: 'probe', args: {}, conversationId: 'session-b' }
    });

    assert.equal(ctxA.result.workspace, workspaceA);
    assert.equal(ctxB.result.workspace, workspaceB);
    assert.equal(ctxA.result.workspaceSource, 'session');
    assert.equal(ctxB.result.workspaceSource, 'session');
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
