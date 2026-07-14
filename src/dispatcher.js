// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { WorkspaceStage } from './runtime/stages/WorkspaceStage.js';
import { GuardStage } from './runtime/stages/GuardStage.js';
import { WorkspacePolicyStage } from './runtime/stages/WorkspacePolicyStage.js';
import { PathPolicyStage } from './runtime/stages/PathPolicyStage.js';
import { BackupPolicyStage } from './runtime/stages/BackupPolicyStage.js';
import { RuleStage } from './runtime/stages/RuleStage.js';
import { SkillStage } from './runtime/stages/SkillStage.js';
import { MemoryStage } from './runtime/stages/MemoryStage.js';
import { CapabilityContextStage } from './runtime/stages/CapabilityContextStage.js';

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
  runtime.use(WorkspacePolicyStage);
  runtime.use(PathPolicyStage);
  runtime.use(BackupPolicyStage);
  runtime.use(GuardStage);
  runtime.use(RuleStage);
  runtime.use(SkillStage);
  runtime.use(MemoryStage);
  runtime.use(CapabilityContextStage);
  
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
