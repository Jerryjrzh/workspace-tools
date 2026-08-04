# RuntimeContext Contract (唯一权威定义)

> 版本：v2.1 · 更新：2026-08-04
> 依据：`NEXT_STEPS_v2.1.md` P0-L0「建立唯一 Context Contract」

本文档是 `RuntimeContext` 的唯一权威定义。所有 Stage、Tool、Planner、
Provider 必须依赖此契约；新增字段只改一处（`src/runtime/AgentRuntime.js`
中的 `RuntimeContext`），不再散落十几个文件。

---

## 1. 核心原则

1. **单一数据源**：整个 stage pipeline 共享同一个 `ctx`，无隐式全局状态。
2. **固定字段集**：以下字段是契约的一部分；新增能力必须显式加入本表并同步
   `RuntimeContext` 构造器。
3. **只读约定**：Stage/Tool 可写 `state / result / session / memory` 等运行时数据，
   但不得改写 `sessionId / toolRequest.name` 等身份字段。

## 2. Runtime Lifecycle 契约

AgentRuntime 按以下顺序执行（每个阶段均可通过 `hooks` 覆盖，为
Streaming / Multi-Agent / Background Task 预留扩展点）：

```
initialize()     分配资源、接线 Provider
beforeRequest()  请求前副作用 / Telemetry
buildContext()   从 initialData 组装完整 RuntimeContext
execute()        运行 stage pipeline（核心）
afterExecute()   管线后副作用（日志 / Metrics）
persist()        持久化状态到磁盘
cleanup()        释放资源、关闭 watcher
```

## 3. Context 字段表

| 字段 | 类型 | 职责 | 由谁写入 |
| --- | --- | --- | --- |
| `sessionId` | string\|null | 当前会话 ID（取自 toolRequest.conversationId） | Dispatcher / RuntimeContext |
| `taskId` | string\|null | 任务 ID | initialData |
| `workspace` | string\|null | 已解析的工作区路径 | WorkspaceStage |
| `session` | object | 会话状态（summary/snapshot/capabilities…） | SessionRecovery / Summary / Snapshot |
| `conversation` | object\|null | 对话消息列表 | RuntimeContextStage / ConversationLoad |
| `task` | string\|null | 任务类型（coding/debug/general） | TaskPolicyStage |
| `rules` | array | 已加载规则 | RuleStage |
| `skills` | array | 已加载技能 | SkillStage |
| `memory` | object | Memory store（entries/profiles/…） | MemoryStage / MemoryManager |
| `retrievedMemory` | array | 检索到的记忆条目 | MemoryRetrieveStage |
| `promptContext` | object\|null | Prompt 组装结果 | CapabilityContextStage |
| `executionPlan` | object\|null | Planner 执行计划 | PlannerStage |
| `executionHints` | object\|null | 执行提示（summary/systemPrompt） | CapabilityContextStage |
| `toolRequest` | {name,args} | 当前工具请求 | Dispatcher / initialData |
| `state` | object | 运行时中间状态（absolutePath…） | 各 Stage |
| `result` | any\|null | 最终执行结果 | Tool Executor |
| `providerRegistry` | ProviderRegistry\|null | 统一 Provider 注册表 | Dispatcher |
| `memoryManager` | MemoryManager\|null | Memory 管理器实例 | MemoryStage |
| `capabilities` | object\|null | 系统能力声明（Shell/Git/Docker…） | CapabilityContextStage |
| `planner` | object\|null | Planner 实例 | initialData / Dispatcher |
| `runtimeState` | object | Runtime 级状态机数据 | AgentRuntime |
| `timestamp` | number | 创建时间戳 | RuntimeContext |
| `error` | Error\|null | 管线错误（若有） | AgentRuntime |

## 4. Tool Contract

所有 Tool 统一返回结构化对象：

```js
{
  ok: true,
  data: <原始结果>,
  type: 'string' | 'json' | 'mcp_content',
  meta: { tool, durationMs }
}
```

禁止 string / JSON / MCP Content 混用（见 `docs/RUNTIME_ARCHITECTURE.md`）。

## 5. Provider Contract

所有 Provider（Memory / Rule / Workspace / Session）统一实现：

```js
load(sessionId)      // 读取
save(sessionId, data) // 写入
watch(sessionId, cb)  // 订阅变更（可选）
dispose()            // 释放资源（可选）
```

为 SQLite / Redis / Cloud / Workspace 多后端预留切换能力。

## 6. Event Bus Contract

AgentRuntime 之上提供领域事件：

```
BeforeTool / AfterTool / ContextBuilt / MemoryLoaded /
SessionStarted / WorkspaceChanged
```

Memory、Telemetry、Log、Plugin、UI、Streaming 全部以 Observer 订阅，
而非互相调用（见 `src/runtime/EventBus.js`）。

## 7. Capability Contract

Runtime 启动时收集系统能力并注入 `ctx.capabilities`：

```js
{
  shell: true, git: true, docker: false,
  python: true, workspace: '/path', ssh: false
}
```

Planner 依据 Capability 决定是否调用某 Tool，避免 Prompt 无限变长。

## 8. Plugin Contract

Plugin 通过 `pluginRegistry.register()` 注册 Tool / Stage / Policy，
防止 Dispatcher 越来越大（见 `src/runtime/plugins/PluginRegistry.js`）。
