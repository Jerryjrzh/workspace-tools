import fs from 'fs';
import path from 'path';
import os from 'os';

export async function MemoryStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  const memoryDir = path.join(os.homedir(), '.lmstudio', 'memory');
  const memoryFile = sessionId ? path.join(memoryDir, `${sessionId}.json`) : null;

  let memory = { entries: [] };
  if (memoryFile && fs.existsSync(memoryFile)) {
    try {
      memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    } catch {
      memory = { entries: [] };
    }
  }

  ctx.memory = memory;
  ctx.session = ctx.session || {};
  ctx.session.memory = memory;
  return next();
}
