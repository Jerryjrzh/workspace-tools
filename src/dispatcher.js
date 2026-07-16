// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { applyRuntimeFramework } from './runtime/framework.js';
import { executeTool } from './runtime/toolRouter.js';
import { ProviderRegistry } from './runtime/providers/ProviderRegistry.js';
import { memoryProvider } from './runtime/providers/MemoryProvider.js';
import { conversationProvider } from './runtime/providers/ConversationProvider.js';
import { workspaceManager } from './managers/workspace.js';
import { sessionPersistenceProvider } from './runtime/providers/SessionPersistenceProvider.js';

/**
 * Create a Runtime instance with core stages
 */
function createRuntime() {
  const providerRegistry = new ProviderRegistry({
    conversation: conversationProvider,
    workspace: workspaceManager,
    persistence: sessionPersistenceProvider,
    memory: memoryProvider
  });

  const runtime = new AgentRuntime();
  runtime.providerRegistry = providerRegistry;

  applyRuntimeFramework(runtime);

  runtime.use(async (ctx, next) => {
    const toolName = ctx.toolRequest.name;
    ctx.result = await executeTool(toolName, ctx.toolRequest.args, {
      sessionId: ctx.sessionId || ctx.toolRequest.conversationId,
      workspace: ctx.workspace,
      session: ctx.session,
      conversation: ctx.conversation,
      providerRegistry: ctx.providerRegistry,
      memoryManager: ctx.memoryManager,
      runtime: ctx
    });
    return next();
  });

  return runtime;
}

// Create single runtime instance
const runtime = createRuntime();

/**
 * Dispatch tool request using Runtime pipeline
 * @param {Object} request - { name, args, conversationId }
 * @returns {Promise<any>} - Tool execution result
 */
async function dispatch(request) {
  const initialData = {
    sessionId: request.conversationId,
    toolRequest: {
      name: request.name,
      args: request.args,
      conversationId: request.conversationId
    },
    providerRegistry: runtime.providerRegistry
  };

  const ctx = await runtime.execute(initialData);
  return ctx.result;
}

export { dispatch, runtime };
