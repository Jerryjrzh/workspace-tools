import { memoryManager } from '../../managers/memory.js';
import { memoryProvider } from '../providers/MemoryProvider.js';

export async function MemoryStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  const provider = ctx.providerRegistry?.get?.('memory') || memoryProvider;
  const manager = ctx.memoryManager || memoryManager;

  ctx.memoryManager = manager;
  ctx.memoryProvider = provider;
  ctx.memory = sessionId ? manager.load(sessionId) : { entries: [] };
  ctx.session = ctx.session || {};
  ctx.session.memory = ctx.memory;
  ctx.session.memoryStore = ctx.memory;
  return next();
}

export default MemoryStage;
