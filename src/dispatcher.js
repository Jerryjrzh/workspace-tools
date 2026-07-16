// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { applyRuntimeFramework } from './runtime/framework.js';
import { ProviderRegistry } from './runtime/providers/ProviderRegistry.js';
import { memoryProvider } from './runtime/providers/MemoryProvider.js';
import { conversationProvider } from './runtime/providers/ConversationProvider.js';
import { workspaceManager } from './managers/workspace.js';
import { sessionPersistenceProvider } from './runtime/providers/SessionPersistenceProvider.js';

// Import slimmed tools
import { file_read } from './tools/file_read.js';
import { file_patch } from './tools/file_patch.js';
import { shell_run } from './tools/shell_run.js';
import { handleMemoryTools } from './tools/memory.js';

// Map tool names to implementations
const toolMap = {
  file_read,
  file_patch,
  shell_run
};

const memoryToolNames = new Set(['memory_remember', 'memory_forget', 'memory_search']);

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
    if (memoryToolNames.has(toolName)) {
      ctx.result = await handleMemoryTools(toolName, ctx.toolRequest.args, {
        sessionId: ctx.sessionId || ctx.toolRequest.conversationId
      });
      return next();
    }

    const toolFn = toolMap[toolName];
    if (!toolFn) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    ctx.result = await toolFn(ctx, ctx.toolRequest.args);
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
