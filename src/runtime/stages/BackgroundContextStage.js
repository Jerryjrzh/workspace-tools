// src/runtime/stages/BackgroundContextStage.js
import { memoryManager } from '../../managers/memory.js';

export async function BackgroundContextStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    ctx.memoryBackground = null;
    return next();
  }

  const manager = ctx.memoryManager || memoryManager;
  const background = manager.getBackgroundContext(sessionId);

  ctx.memoryBackground = background;
  ctx.state = ctx.state || {};
  ctx.state.backgroundContext = background;
  ctx.session = ctx.session || {};
  ctx.session.memoryBackground = background;
  return next();
}

export default BackgroundContextStage;