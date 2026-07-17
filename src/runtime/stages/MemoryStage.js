import { memoryManager } from '../../managers/memory.js';
import { memoryProvider } from '../providers/MemoryProvider.js';

export async function MemoryStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  const provider = ctx.providerRegistry?.get?.('memory') || memoryProvider;
  const manager = ctx.memoryManager || memoryManager;

  ctx.memoryManager = manager;
  ctx.memoryProvider = provider;
  ctx.memory = sessionId ? manager.loadStore(sessionId) : manager.createEmptyStore();
  ctx.memoryBackground = sessionId ? manager.getBackgroundContext(sessionId) : {
    identity: [],
    soul: [],
    recentActivity: []
  };
  ctx.session = ctx.session || {};
  ctx.session.memory = ctx.memory;
  ctx.session.memoryStore = ctx.memory;
  ctx.session.memoryBackground = ctx.memoryBackground;
  return next();
}

export default MemoryStage;
