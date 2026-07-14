import fs from 'fs';
import path from 'path';
import os from 'os';

export async function SessionPersistStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const sessionDir = path.join(os.homedir(), '.lmstudio', 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const statePath = path.join(sessionDir, `${sessionId}.json`);
  const state = {
    sessionId,
    workspace: ctx.workspace || null,
    task: ctx.task || null,
    summary: ctx.session?.summary || null,
    snapshot: ctx.session?.snapshot || null,
    conversation: ctx.conversation || null,
    initialized: true,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

  ctx.session = ctx.session || {};
  ctx.session.persisted = true;
  ctx.session.statePath = statePath;
  ctx.sessionState = state;
  return next();
}
