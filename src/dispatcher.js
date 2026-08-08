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
import { autoCompactConversation } from './tools/contextCompact.js';

/**
 * 任务结束信号：这些收尾型工具执行成功后，说明一个 Task 已完成，
 * 触发自动上下文压缩（抑制 Task 过程步骤与早期消息）。
 */
const TASK_COMPLETION_TOOLS = new Set([
  'task_checkpoint',
  'git_commit'
]);

/** 记录每个会话最近一次自动压缩时间，避免同一任务重复压缩 */
const lastCompactAt = new Map();

/**
 * 在业务工具执行成功后检测"任务结束信号"，触发自动上下文压缩。
 * 仅当该会话尚未在本轮 Task 中压缩过时执行（幂等）。
 *
 * @param {string} toolName - 刚执行的业务工具名
 * @param {string} sessionId - 当前会话 ID
 */
function maybeAutoCompact(toolName, sessionId) {
  if (!TASK_COMPLETION_TOOLS.has(toolName)) return;
  if (!sessionId || sessionId === 'default') return;

  // 同一会话在较短时间内已压缩过 → 跳过（幂等保护）
  const now = Date.now();
  const lastAt = lastCompactAt.get(sessionId);
  if (lastAt && (now - lastAt) < 60_000) return;
  lastCompactAt.set(sessionId, now);

  // 异步触发，不阻塞工具返回
  autoCompactConversation(sessionId).then((res) => {
    if (!res.ok) {
      console.warn(`[auto-compact] ${sessionId}: ${res.message}`);
      return;
    }
    console.log(`[auto-compact] ${sessionId}: ${res.message} (${res.backupPath})`);
  }).catch((err) => {
    console.warn(`[auto-compact] ${sessionId} 失败: ${err.message}`);
  });
}

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

  // Task 完成信号：业务工具执行成功后，若属于收尾型工具则触发自动上下文压缩
  maybeAutoCompact(toolName, sessionId);

  return ctx.result;
}

export { dispatch, runtime };
