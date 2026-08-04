// src/dispatcher.js - New Dispatcher using Runtime
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { applyRuntimeFramework } from './runtime/framework.js';
import { executeTool } from './runtime/toolRouter.js';
import { ProviderRegistry } from './runtime/providers/ProviderRegistry.js';
import { memoryProvider } from './runtime/providers/MemoryProvider.js';
import { conversationProvider } from './runtime/providers/ConversationProvider.js';
import { ruleProvider } from './runtime/providers/RuleProvider.js';
import { workspaceManager } from './managers/workspace.js';
import { sessionContextManager } from './managers/sessionContext.js';
import { sessionPersistenceProvider } from './runtime/providers/SessionPersistenceProvider.js';

/**
 * Bootstrap tools are lifecycle primitives that establish context rather than consume it.
 * They must not run the full stage pipeline (WorkspaceStage, MemoryExtractStage, ...) —
 * doing so would resolve a stale workspace or trigger disk writes before the tool runs.
 */
const BOOTSTRAP_TOOLS = new Set([
  'workspace_set',
  'session_start',
  'workspace_info',
  'load_global_rules',
  'load_task_rules',
  'workspace_clear'
]);

/**
 * Create a Runtime instance with core stages
 */
function createRuntime() {
  const providerRegistry = new ProviderRegistry({
    conversation: conversationProvider,
    workspace: workspaceManager,
    persistence: sessionPersistenceProvider,
    memory: memoryProvider,
    rules: ruleProvider
  });

  const runtime = new AgentRuntime();
  runtime.providerRegistry = providerRegistry;

  applyRuntimeFramework(runtime);

  // Final stage: execute the tool with the fully-populated runtime context.
  runtime.use(async (ctx, next) => {
    const toolName = ctx.toolRequest.name;
    ctx.result = await executeTool(toolName, ctx.toolRequest.args, {
      sessionId: ctx.sessionId || ctx.toolRequest.conversationId,
      workspace: ctx.workspace,
      task: ctx.task,
      rules: ctx.rules,
      skills: ctx.skills,
      memory: ctx.memory,
      retrievedMemory: ctx.retrievedMemory,
      conversation: ctx.conversation,
      session: ctx.session,
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
 * Dispatch tool request using Runtime pipeline.
 *
 * Bootstrap tools bypass the stage pipeline and execute directly; business tools run through
 * all stages so that workspace/session/rules/memory are resolved before execution.
 *
 * @param {Object} request - { name, args, conversationId }
 * @returns {Promise<any>} - Tool execution result
 */
async function dispatch(request) {
  const toolName = request.name;
  const sessionId = request.conversationId;

  // Bootstrap tools only run on the first call of a fresh session. Once a session is
  // initialized, later calls must not re-enter bootstrap (session_start / workspace_set) —
  // they should report current state instead of re-running lifecycle primitives.
  if (BOOTSTRAP_TOOLS.has(toolName)) {
    const context = sessionContextManager.getOrCreateContext(sessionId);

    // Query/clear tools are always safe to run regardless of initialization state.
    const alwaysRun = new Set(['workspace_info', 'workspace_clear', 'load_global_rules', 'load_task_rules']);
    if (!context.initialized || alwaysRun.has(toolName)) {
      return executeTool(toolName, request.args || {}, {
        sessionId,
        workspace: null,
        conversation: null
      });
    }

    // Session already initialized: do not re-run bootstrap lifecycle tools.
    const ws = context.workspace || workspaceManager.getWorkspaceForSession(sessionId);
    return {
      status: 'SESSION_READY',
      session_id: sessionId,
      workspace: ws || null,
      active_task: context.task || 'none',
      rules_loaded: (context.rules || []).length,
      details: { message: '会话已初始化，无需重复 bootstrap。', already_initialized: true }
    };
  }

  const initialData = {
    sessionId: request.conversationId,
    toolRequest: {
      name: toolName,
      args: request.args || {},
      conversationId: request.conversationId
    },
    providerRegistry: runtime.providerRegistry
  };

  let ctx;
  try {
    ctx = await runtime.execute(initialData);
  } catch (err) {
    // Transparent bootstrap fallback: if the pipeline was blocked because no workspace is set,
    // resolve one from persisted state or conversation and retry once. This preserves the legacy
    // "first business call auto-bootstraps" behavior without requiring an explicit session_start.
    const { autoResolveWorkspace, persistResolvedWorkspace } = await import('./managers/autoBootstrap.js');
    const workspace = await autoResolveWorkspace(request.conversationId, request.args);
    if (!workspace) {
      throw err;
    }
    persistResolvedWorkspace(request.conversationId, workspace);
    initialData.workspace = workspace;
    ctx = await runtime.execute(initialData);
  }

  return ctx.result;
}

export { dispatch, runtime };
