# Runtime Architecture v2.1

> 更新：2026-08-04
> 依据：`NEXT_STEPS_v2.1.md` P3-L3「更新 RUNTIME_ARCHITECTURE.md」
> 本文档描述当前真实架构（stage-pipeline + dispatcher），取代旧的 harness 文档。

## Overview

workspace-tools 已从"工具集合"演进为 **Agent Runtime**。核心是
Dispatcher → AgentRuntime(stage pipeline) → Tool Executor，所有状态通过单一
`RuntimeContext` 契约流动（见 `docs/CONTEXT_CONTRACT.md`）。

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        USER REQUEST (tool call)                            │
└───────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                    DISPATCHER (src/dispatcher.js)                          │
│  • bootstrap tools → 直接执行（不跑 stage pipeline）                        │
│  • business tools → runtime.execute() 全管线                              │
│  • autoBootstrap 透明兜底                                                 │
└───────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                    AGENT RUNTIME (src/runtime/AgentRuntime.js)             │
│  Lifecycle: initialize → beforeRequest → buildContext → execute            │
│              → afterExecute → persist → cleanup                            │
│  EventBus: BeforeTool / AfterTool / ContextBuilt / MemoryLoaded /          │
│            SessionStarted / WorkspaceChanged                               │
└───────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                    STAGE PIPELINE (src/runtime/framework.js)               │
│  Workspace → RuntimeContext → ContextBudget → SessionRecovery              │
│    → Policies(Workspace/Path/Backup) → Rule/Skill/Memory                  │
│    → MemoryExtract/Retrieve → Identity/Soul → Background                   │
│    → Capability → Planner → Syntax/Permission Guard                       │
└───────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                    TOOL EXECUTOR (src/runtime/toolRouter.js)               │
│  • ToolResult contract（统一返回类型）                                      │
│  • normalizeResult() 供 Streaming/UI 边界使用                              │
└───────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Dispatcher (`src/dispatcher.js`)

**职责**：唯一请求入口。区分 bootstrap / business tools。

- **Bootstrap tools**（workspace_set/session_start/…）：直接执行，不跑 stage，
  避免解析过期 workspace 或提前触发磁盘写入。
- **Business tools**：走完整 stage pipeline，先解析 workspace/session/rules/
  memory 再执行工具。
- **autoBootstrap**：首次业务调用无 workspace 时透明兜底（`managers/autoBootstrap.js`）。

### 2. AgentRuntime (`src/runtime/AgentRuntime.js`)

**职责**：核心引擎。Onion pipeline + EventEmitter。

显式生命周期契约：

```
initialize()     分配资源、接线 Provider
beforeRequest()  请求前副作用 / Telemetry
buildContext()   组装 RuntimeContext
execute()        运行 stage pipeline（核心）
afterExecute()   管线后副作用
persist()        持久化状态
cleanup()        释放资源
```

每个阶段可通过 `hooks` 覆盖，为 Streaming / Multi-Agent / Background Task 预留扩展点。

### 3. Stage Pipeline (`src/runtime/framework.js`)

**职责**：按序执行 stage，共享同一 `ctx`。当前接线顺序：

| # | Stage | 职责 |
| --- | --- | --- |
| 1 | WorkspaceStage | 解析工作区路径 |
| 2 | RuntimeContextStage | 加载 conversation + workspace（ProviderRegistry） |
| 3 | ContextBudgetStage | 上下文 token 预算抑制（必须在 conversation 之后） |
| 4 | SessionRecoveryStage | 会话恢复 |
| 5-7 | Workspace/Path/BackupPolicyStage | 路径与备份策略守卫 |
| 8 | RuleStage | 加载 global/project/task rules |
| 9 | SkillStage | 加载 skills |
| 10 | MemoryStage | 初始化 memoryManager + store |
| 11-12 | MemoryExtract / Retrieve | 提取并检索记忆 |
| 13-14 | Identity / SoulRetrieve | 身份与灵魂记忆 |
| 15 | BackgroundContextStage | 背景上下文组装 |
| 16 | CapabilityContextStage | 注入系统能力 + prompt context |
| 17 | PlannerStage | 执行计划生成 |
| 18-19 | Syntax / PermissionPolicyStage | 写操作守卫（node --check / deny） |
| 20 | GuardStage | 最终策略守卫 |

> **未接线但保留**：SessionLifecycleStage / ConversationLoadStage /
> SummaryStage / SnapshotStage / SessionPersistStage / TaskPolicyStage /
> SessionStatePolicyStage —— 作为可组合导出供测试与嵌入使用；主管线由
> RuntimeContextStage 加载 conversation，避免重复磁盘读取。

### 4. Providers (`src/runtime/providers/`)

**职责**：统一持久化接口 `load/save/watch/dispose`（见 CONTEXT_CONTRACT §5）。

| Provider | 后端 |
| --- | --- |
| MemoryProvider | `.lmstudio/memory/*.json` |
| SessionPersistenceProvider | conversations / sessions / snapshots |
| ConversationProvider | conversation JSON |
| SessionStateProvider | session state JSON |
| RuleProvider | global/task/project rules（只读） |
| ProviderRegistry | 统一注册表 + disposeAll() |

### 5. Event Bus (`src/runtime/EventBus.js`)

**职责**：领域事件。Memory / Telemetry / Log / Plugin / UI / Streaming 全部以
Observer 订阅，而非互相调用。

```
BeforeTool / AfterTool / ContextBuilt /
MemoryLoaded / SessionStarted / WorkspaceChanged
```

### 6. Capabilities (`src/runtime/capabilities.js`)

**职责**：启动时检测系统能力（Shell/Git/Docker/Python/Node/SSH/Workspace），
注入 `ctx.capabilities`。Planner 据此决定是否调用某 Tool，避免 Prompt 无限变长。

### 7. Plugin Registry (`src/runtime/plugins/PluginRegistry.js`)

**职责**：插件扩展点。可注册 Tool / Stage / Policy，防止 Dispatcher 越来越大。

## Context Contract

唯一权威定义见 `docs/CONTEXT_CONTRACT.md`。核心字段：

```
sessionId / workspace / session / conversation / task /
rules / skills / memory / retrievedMemory / promptContext /
executionPlan / executionHints / toolRequest / state / result /
providerRegistry / memoryManager / capabilities / planner / runtimeState
```

## Tool Contract

所有工具统一返回结构化对象（见 CONTEXT_CONTRACT §4）：

```js
{ ok, data, type: 'string'|'json'|'mcp_content', meta: { tool, durationMs } }
```

`toolRouter.normalizeResult()` 在 Streaming/UI 边界收敛类型；Dispatcher 保持
向后兼容返回原始结果。

## Memory Growth Control (P2-L2)

- **ContextBudgetStage**：位于 RuntimeContextStage 之后，动态预算钳制为
  `min(动态, tokenBudget)`。
- **Memory search**：先按词项命中过滤再叠加排序分，避免无关记忆混入。
- **isConflict**：仅显式同键且互不包含才算真冲突；细化走 update。
- **Global store budget**：`maxEntries=500` + `maxEntryChars=2000`，
  upsertEntry 强制截断与按优先级淘汰。

## Usage

```javascript
import { dispatch } from './src/dispatcher.js';

// Business tool call → full stage pipeline
const result = await dispatch({
  name: 'file_read',
  args: { path: 'README.md' },
  conversationId: 'session-123'
});
```

## Future Enhancements

- [ ] Streaming / Multi-Agent / Background Task（基于 lifecycle hooks）
- [ ] SQLite / Redis Provider 后端切换
- [ ] Tracing / Metrics 全链路观测
- [ ] ADR 架构决策记录
