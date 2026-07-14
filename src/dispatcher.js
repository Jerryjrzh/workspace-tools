// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { WorkspaceStage } from './runtime/stages/WorkspaceStage.js';

// Import slimmed tools
import { file_read } from './tools/file_read.js';
import { file_patch } from './tools/file_patch.js';
import { shell_run } from './tools/shell_run.js';

// Map tool names to implementations
const toolMap = {
  file_read,
  file_patch,
  shell_run
};

/**
 * Create a Runtime instance with core stages
 */
function createRuntime() {
  const runtime = new AgentRuntime();
  
  // Register core stages
  runtime.use(WorkspaceStage);
  
  // Add tool execution as final stage
  runtime.use(async (ctx, next) => {
    const toolName = ctx.toolRequest.name;
    const toolFn = toolMap[toolName];
    
    if (!toolFn) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    ctx.result = await toolFn(ctx, ctx.toolRequest.args);
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
    toolRequest: {
      name: request.name,
      args: request.args,
      conversationId: request.conversationId
    }
  };
  
  return await runtime.execute(initialData);
}

export { dispatch, runtime };
