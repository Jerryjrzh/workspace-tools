// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { WorkspaceStage } from './runtime/stages/WorkspaceStage.js';
import { RuntimeContextStage } from './runtime/stages/RuntimeContextStage.js';
import { SessionRecoveryStage } from './runtime/stages/SessionRecoveryStage.js';
import { GuardStage } from './runtime/stages/GuardStage.js';
import { WorkspacePolicyStage } from './runtime/stages/WorkspacePolicyStage.js';
import { PathPolicyStage } from './runtime/stages/PathPolicyStage.js';
import { BackupPolicyStage } from './runtime/stages/BackupPolicyStage.js';
import { RuleStage } from './runtime/stages/RuleStage.js';
import { SkillStage } from './runtime/stages/SkillStage.js';
import { MemoryStage } from './runtime/stages/MemoryStage.js';
import { MemoryExtractStage } from './runtime/stages/MemoryExtractStage.js';
import { MemoryRetrieveStage } from './runtime/stages/MemoryRetrieveStage.js';
import { CapabilityContextStage } from './runtime/stages/CapabilityContextStage.js';
import { PlannerStage } from './runtime/stages/PlannerStage.js';
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

  runtime.use(WorkspaceStage);
  runtime.use(RuntimeContextStage);
  runtime.use(SessionRecoveryStage);
  runtime.use(WorkspacePolicyStage);
  runtime.use(PathPolicyStage);
  runtime.use(BackupPolicyStage);
  runtime.use(RuleStage);
  runtime.use(SkillStage);
  runtime.use(MemoryStage);
  runtime.use(MemoryExtractStage);
  runtime.use(MemoryRetrieveStage);
  runtime.use(CapabilityContextStage);
  runtime.use(PlannerStage);
  runtime.use(GuardStage);

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
