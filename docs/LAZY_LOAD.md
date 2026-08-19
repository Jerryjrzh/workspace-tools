# Tool Call 懒加载流程 (Lazy Loading) — 实施情况

> 更新：2026-08（当前 working tree）
> 依据：`docs/lazy_load_review.md`
> 范围：`src/tools/registry.js` + `discovery.js` + `groups.js` + `runtime/toolRouter.js` + `server.js`

## 1. 两个必须分开的层级

review 指出当前实现只完成了 **execution-time lazy loading**（模块懒加载），
但缺少 **model-driven discovery**（模型主动发现并启用非 core 工具）。二者是不同层级：

| 层级 | 解决的问题 | 状态 |
| --- | --- | --- |
| execution-time lazy loading | "已被调用的 tool 无需提前 import JS module" | ✅ 已实施 |
| model-driven discovery | "模型不知道某 tool 存在怎么办" | ✅ 本次补齐 |

> ⚠️ `registry 能加载` ≠ `MCP 能调用` ≠ `模型能发现`。
> 旧实现中 `ListTools → enabled groups` + `CallTool → isToolEnabled(false)`，
> 使未启用非-core tool 对模型完全不可见，因此"未启用组也能自动路由"
> 仅在 Dispatcher/Registry 层面成立。

## 2. 三个概念分离

```
Discover        = 能力发现（workspace_discover，core 永远可见）
Promote         = 能力状态变化（capability set version++）
Dynamic Import  = 代码加载（registry.loadModule，已有）
```

三者不能混在一起：**module loaded ≠ tool promoted**。

## 3. 完整架构图

```
                       ┌───────────────┐
                       │     Model     │
                       └───────┬───────┘
                               │
                       visible core tools（含 workspace_discover）
                               │
                 ┌─────────────▼─────────────┐
                 │   workspace_discover      │  ← core，永远可见
                 └─────────────┬─────────────┘
                               │         capability query {capability, tool?, select?}
                               ▼
                    ┌────────────────────┐
                    │ Capability Registry│   ← discovery.js DISCOVERABLE_TOOLS
                    │ (静态能力目录)      │    含轻量 schema(summary/usage/examples)
                    │   不 import module │     绝不触发 lazy-load 破坏
                    └─────────┬──────────┘
                              │         Level1: listCapabilities(capability)
                              │         Level2: getCapability(tool, detail:"full")
                              ▼
                    返回候选能力集（模型理解/比较/选择）
                              │
                              ▼
                       promote(selected)     ← capabilitySet.promote() + onChanged
                              │               toolSetVersion++ → notify client/runtime
                    ┌─────────▼─────────┐
                    │ Capability Set    │
                    │ version++         │
                    └─────────┬─────────┘
                              │
                    rebuild LLM tools        ← listEnabledTools(options, capset)
                              │              core + enabled groups + promoted ops
                              ▼
                         Model #2（tools 含新 tool）
                              │
                              ▼
                         file_read() / shell_run()
                              │
                              ▼
                    ┌───────────────────┐
                    │ Dynamic Import    │   ← registry.loadModule()
                    │ registry.load()   │     execution-time lazy loading
                    └───────────────────┘
```

## 4. Tool Call 完整流程（含 discovery）

```
MCP Client → CallToolRequest { name, args }
   │
   ▼
┌─────────────── server.js ──────────────────────────────────────────┐
│ ListToolsRequestSchema → await listEnabledTools(options, capset)   │
│    = core + enabled groups + promoted ops（广告面）                  │
│                                                                   │
│ CallToolRequestSchema                                              │
│   ├─ isToolEnabled(name, options, capset)                         │
│   │    静态判断；promoted 工具视为可用                               │
│   └─ handleTool() → runtimeDispatch({name,args,conversationId})   │
└──────────────────────────┬─────────────────────────────────────────┘
                          ▼
┌──────────── src/dispatcher.js (dispatch) ─────────────────────────┐
│  Bootstrap tools → executeTool() 直接执行                          │
│  Business tools → runtime.execute() 全管线                        │
│    final stage: ctx.result = await executeTool(name, args, ctx)   │
└──────────────────────────┬─────────────────────────────────────────┘
                          ▼
┌──── src/runtime/toolRouter.js (executeTool) ──────────────────────┐
│  const handler = await getToolHandler(toolName);                  │
│  return handler(name, args, context);                             │
└──────────────────────────┬─────────────────────────────────────────┘
                          ▼
┌──── src/tools/registry.js (getToolHandler / loadModule) ──────────┐
│  ① TOOL_TO_MODULE[toolName] → moduleKey（静态路由）                 │
│  ② loadModule(key): loadedModules.has ? 缓存 : import(def.path)   │
│  ③ return mod[MODULES[key].handlers]                              │
└──────────────────────────┬─────────────────────────────────────────┘
                          ▼
                工具 handler 执行 → 返回结果
```

## 5. workspace_discover（core，永远可见）— Capability Discovery / Tool Help

> ⚠️ 依据 docs/lazy_load_review2.md：workspace_discover **不是 Tool Resolver**
> （query → 自动匹配 → promote），而是**动态能力手册**。模型负责理解、比较、
> 选择；Runtime 只负责加载与注入。
>
> ```
> ❌ Query → 自动匹配 → Promote
> ✅ Need → Discover → Capability Set → Model Select → Promote → Use
> ```

## 5. workspace_discover（core，永远可见）— Capability Discovery / Tool Help

> ⚠️ 依据 docs/lazy_load_review4.md + review5：workspace_discover **不是 Tool Resolver**
> （query → 自动匹配 → promote），而是**动态能力手册**。模型负责理解、比较、
> 选择；Runtime 只负责加载与注入（promote）。
>
> ```
> ❌ Query → 自动匹配 → Promote
> ✅ Need → Discover → Capability Set → Model Select → Runtime promote → Use
> ```

### workspace_discover({ need }) — 候选能力目录 + 完整 Example

```jsonc
workspace_discover({ "need": "execute pwd" })
// →
{
  "status": "capabilities",
  "capabilities": [
    { "id": "shell_run",      "summary": "Execute a local shell command." },
    { "id": "process_start",  "summary": "Start a background process / service." },
    { "id": "process_output", "summary": "Read output of a background process." }
  ],
  "example": {
    "need":   "check the current directory",
    "select": "shell_run",
    "call":   "shell_run({\"command\":\"pwd\"})"
  }
}
```

**这里不做选择、不自动 promote。** Runtime 只提供候选 + 一个完整 lazy-load
示范（example），模型自己判断哪个最合适，并**按 example 的模式类推调用方式**。

> ⚠️ review5：capabilities[] 只保留 `{id, summary}`——不给每个 capability
> 携带完整调用协议。Discovery 结果本身就是一个 **lazy-load 教程**：
> "有哪些能力" + 一个完整 Example（need → select → call），让模型从示范中
> 理解"发现 → 选择 → 调用"的过程，然后类推。

### 空结果

```jsonc
workspace_discover({ "need": "量子计算能力" })
// →
{ "status": "empty", "need": "...", "message": "未找到匹配 \"...\" 的能力。" }
```

> review4 T3：删除 `no_match` + retry hint（诱导换关键词重试），空结果返回 empty。

### Promote（Runtime 内部状态机，不作为模型协议）

- 模型在 workspace_discover 看到候选后，**下一轮直接调用所选工具名**。
- server.js CallTool guard 检测到"可发现(ops)但未注入的工具被调用"时自动 promote + refresh，
  返回提示（下一轮完整 schema 可用）。
- **不暴露独立 select/promote/load_module tool**（避免工具膨胀）。

### 模型认知循环

```
我有什么能力？→ 不够 → discover need
  → 看到候选能力集 + example → 比较/理解 → 直接调用所选工具名 → 下一轮使用
```

模型完全不知道 `promote / loadModule / dynamic import / registry / moduleKey` ——
这些是 Runtime 内部实现。

## 6. ToolCapabilitySet

```js
class ToolCapabilitySet {
  promoted: Set<string>   // 已提升工具名
  version: number         // toolSetVersion：每次 promote 递增
  promote(name)           // 幂等；变更才 version++
}
```

- `module loaded ≠ tool promoted`：loadModule 只负责代码加载；
  promote 才改变"模型可见能力集"
- server.js / handler 共享同一全局实例 `capabilitySet`

## 7. 静态 Tool Metadata Index（不 import module）

`discovery.js DISCOVERABLE_TOOLS` —— 仅收录默认未启用的 ops(运维)组工具
(shell/tmux/ssh-serial/env)。metadata 精简为 `{name, summary}`，
不做过度设计。listCapabilities() 基于此表做纯文本过滤（need → name/summary），
**绝不触发 import**，否则 discover 本身会打破 lazy-load。

## 8. 实施状态核对

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `src/tools/discovery.js` | **新增**：静态 metadata index + ToolCapabilitySet + workspace_discover | ✅ |
| `src/tools/registry.js` | 注册 discovery module（core）；TOOL_TO_MODULE/MODULES/GROUP_MODULES | ✅ |
| `src/tools/groups.js` | listEnabledTools/isToolEnabled 支持 capabilitySet | ✅ |
| `src/tools/index.js` | 导出 discover/promote/capabilitySet | ✅ |
| `server.js` | ListTools/CallTool 接入共享 capabilitySet | ✅ |

## 9. 验证方式

```bash
# 单元测试（含分组路由）
node --test tests/unit/tool.groups.test.js

# lazy-load + discovery 行为实测
node scripts/lazy-load-smoke.mjs
```

smoke test 覆盖：
- A：execution-time lazy loading（handler 按需加载、缓存命中、静态归属判断）
- B：model-driven discovery（workspace_discover 可见、discover/promote、
  能力集注入广告面、promoted 工具可调用）

## 10. E2E 缺口分析（依据 docs/lazy_load_review1.md）

> ⚠️ **不要把责任推给 MCP Client。** `promote → reconnect → ListTools` 属于
> **session restart based loading**，不是真正的 in-session lazy loading。
>
> 正确链路必须是：
> ```
> LLM#1 → workspace_discover → promote(non-core tool)
>   → capabilitySet/toolSetVersion 更新        ✅（已实现）
>   → server/runtime 通知 capability changed    ❌（缺失）
>   → LLM#2 tools schema refresh                ❌/❓
>   → LLM#2 调用 promoted tool                  ❌（未打通）
> ```

### 10.1 当前代码核查结论

| 环节 | 状态 | 证据 |
| --- | --- | --- |
| `capabilitySet.promote()` + version++ | ✅ | discovery.js，promote 幂等递增 |
| server ListTools → `listEnabledTools(options, capset)` | ✅ | promote 后会注入 schema（需重新请求） |
| **`tools/list_changed` notification** | ✅ 已修复 | server.js 声明 `capabilities.tools.listChanged = true` + 订阅 `onChanged` 调用 `sendToolListChanged()` |
| **Agent Runtime tool snapshot refresh** | ⚠️ 部分 | capabilitySet.onChanged 已提供通知；listEnabledTools 每次基于全局 capset 重算（无缓存）；但 MCP client / Agent Runtime 侧是否 invalidate 旧 tools 数组需 E2E 验证 |

SDK 底层 `Server.sendToolListChanged()`（发送 `notifications/tools/list_changed`）存在，
前置条件 `capabilities.tools.listChanged = true` **已声明**，且 server.js 已在 promote
后显式调用。

### 10.2 E2E 必须打通的两条路径

```
路径 A：MCP notification（server → client）
  workspace_discover
    ↓ promote
  capabilitySet.version++
    ↓
  server.sendToolListChanged()          ← 需声明 listChanged: true + 显式调用
    ↓ notifications/tools/list_changed
  MCP Client refresh tools/list
    ↓
  模型下一轮看到 shell_run

路径 B：Runtime 内部 refresh（server → Agent Runtime）
  workspace_discover
    ↓ promote
  capabilitySet.version++
    ↓
  runtime.invalidateToolCache()          ← 需新增：capabilityChanged 事件
    ↓
  下一轮 LLM request 重新构建 tools      ← 不能复用 session 初始化时的 snapshot
```

> **先把 Runtime 内部 E2E（路径 B）做通，再考虑 MCP notification（路径 A）优化。**
> 避免陷入 "server / client / model" 三方互相甩锅。

### 10.3 workspace_discover description 强化

当前描述偏弱（模型可能不知道何时该用）。应明确告诉模型：

```
Use this tool when the current task requires a capability that is not
present in the currently available tools.
Do not guess unavailable tool names.
Search by capability/task description.
If a suitable tool is found, it will be promoted and become available
in the next model turn.
```

形成清晰的认知循环：**没有能力 → discover → promote → 下一轮使用。**

### 10.4 E2E 强制日志（6 个关键点）

测试必须输出以下标记，任一缺失即失败：

```
[E2E-1] MODEL_TOOLS_BEFORE   tools=[...core, workspace_discover]
[E2E-2] DISCOVER_CALL        query="execute shell command"
[E2E-3] CAPABILITY_PROMOTED  tool=shell_run, toolSetVersion=2
[E2E-4] MODEL_TOOLS_AFTER    tools=[...core, workspace_discover, shell_run]
[E2E-5] LAZY_TOOL_CALL       tool=shell_run
[E2E-6] FINAL_RESPONSE       最终回答
```

> 只要 `[E2E-3]` 成功而 `[E2E-4]` 没有 shell_run，问题就是 **tools refresh**，
> 无需再看模型。

## 11. 待办 / 后续（更新）

已完成：
- [x] server.js 声明 `capabilities.tools.listChanged = true`
- [x] promote 后显式调用 `server.sendToolListChanged()`（订阅 capabilitySet.onChanged）
- [x] ToolCapabilitySet 增加 onChanged 通知机制（路径 B：Runtime 内部 refresh）
- [x] workspace_discover description 强化（明确"缺能力 → discover"循环）
- [x] **review4 T1**：workspace_discover({need}) → capabilities[]，不自动选择、不自动 promote
      （输入从 capability/tool/detail/select 改为 need；schema 仅保留 need）
- [x] **review4 T2**：Capability Catalog metadata 精简为 {name, summary}
      （去掉 usage/examples/when_to_use/category，不做过度设计；group/moduleKey 仅内部路由）
- [x] **review4 T3**：删除 no_match + retry hint，空结果返回 empty
- [x] **review4 T5**：promote 移入 Runtime 内部状态机——模型直接调用目标工具名即触发，
      不作为模型协议的一部分（server.js CallTool guard）
- [x] DISCOVERABLE_TOOLS 精简 schema（{name, summary}）—— Discovery 保持轻量
- [x] **review5**：capabilities[] 只保留 {id, summary}
- [x] **review5**：workspace_discover 返回完整 lazy-load example（need → select → call），
      让模型从示范中类推"发现 → 选择 → 调用"过程，而非给每个 capability 配调用协议

待办：
- [ ] **review4 T6**：Schema Refresh 验证 —— ⚠️ 必须等 promote 真正发生后才能验证
      （当前 toolSetVersion=0，promote 尚未发生；不要现在改 Jinja/DSML）
- [ ] **review4 T8**：完整 E2E（4-step）—— 按真实多轮 tool-call 拆开：
        Turn1: discover({need}) → capabilities[] + example
        Turn2: 调用所选工具名 → Runtime promote → version++
        Turn3: 看到完整 schema → 调用
        Turn4: 回答
- [ ] **review4 T4**：模型根据 capability set 自己选择（代码已支持，需 E2E 验证）
- [x] scripts/lazy-load-smoke.mjs 更新为新 API（need / capabilities[] + example / empty）—— ✅ 本次已同步
- [ ] **暂不提交当前 lazy-load 实现**：只有完整链路通过后才 commit
