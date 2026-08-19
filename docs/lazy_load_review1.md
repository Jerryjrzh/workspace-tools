对，这份反馈已经把问题定位得比较清楚了，而且我认为这里**不能接受“依赖真实 MCP client 验证”作为最终方案**。

现在缺的不是单纯 E2E 测试，而是要确认 **MCP server 的 capability 变化能不能驱动模型下一轮请求重新看到 tool schema**。

### 当前状态实际上是

```text
模型
 │
 │ 看到 core
 ▼
workspace_discover
 │
 ▼
discover
 │
 ▼
promote(shell_run)
 │
 ├── capabilitySet 已变化       ✅
 ├── registry 已变化             ✅
 └── loaded module               ✅
 
但是
 │
 ▼
当前 MCP session 的 tools schema
 │
 └── 没变化                      ❌
 
因此
 │
 ▼
模型下一轮
 │
 └── 仍然不知道 shell_run
```

所以现在的：

> promote 成功

不能等价于：

> 模型获得了这个能力。

---

# 最关键的问题：不要把责任推给 MCP Client

这句话我建议让 Agent 特别注意：

> “必须依赖真实 MCP client + server.js，重新连接后 listEnabledTools 才会把 promoted ops 工具追加到广告面。”

**这里很可能是架构设计本身的问题。**

因为如果：

```text
promote
```

之后必须：

```text
disconnect
→ reconnect
→ ListTools
```

模型才能看到新工具，那么这并不是真正的 runtime lazy-load。

真正应该是：

```text
LLM #1
 ↓
workspace_discover
 ↓
promote(shell_run)
 ↓
server/runtime 通知 capability changed
 ↓
LLM #2 的 tools 更新
 ↓
shell_run()
```

而不是：

```text
LLM #1
 ↓
discover
 ↓
promote
 ↓
重连 MCP
 ↓
ListTools
 ↓
LLM #2
```

后者实际上是：

> **session restart based loading**

不是：

> **in-session lazy loading**

---

# 现在应该重点检查 MCP 协议层

我建议 Agent 先查清楚当前 `server.js` 使用的 MCP SDK/协议能力。

重点找：

```text
ListTools
tools/list
sendToolListChanged
notifications/tools/list_changed
```

如果 SDK 支持：

```text
notifications/tools/list_changed
```

那么正确设计应该是：

```text
workspace_discover
       │
       ▼
    promote
       │
       ▼
capabilitySet.version++
       │
       ▼
server notification
       │
       │ tools/list_changed
       ▼
MCP Client
       │
       ▼
重新获取 tools/list
       │
       ▼
模型下一轮看到 shell_run
```

这才是完整的 E2E。

---

# 但还有一个更重要的问题

即使 MCP client 支持 `tools/list_changed`，也不能保证模型一定重新看到工具。

因为你的架构可能还有：

```text
MCP Client
    ↓
Agent Runtime
    ↓
Model
```

如果 Agent Runtime 在初始化时做：

```js
const tools = await mcp.listTools();
```

然后：

```js
while (...) {
    model.chat({ tools });
}
```

那么 MCP server 即使发：

```text
tools/list_changed
```

**Agent Runtime 自己仍然可能继续使用旧的 `tools` 数组。**

所以必须验证完整链路：

```text
MCP Server
    │
    │ notification
    ▼
MCP Client
    │
    │ refresh
    ▼
Agent Runtime
    │
    │ rebuild model tools
    ▼
LLM
```

任何一层没更新都会导致你现在的现象。

---

# 我建议现在增加一个明确的 Capability Version

现在你们已经有：

```text
promote
capabilitySet
```

很好，但必须再加：

```text
toolSetVersion
```

例如：

```text
初始：

toolSetVersion = 1
tools = [core...]

        ↓

discover("shell")

        ↓

promote(shell_run)

        ↓

toolSetVersion = 2
tools = [core..., shell_run]
```

然后每次模型请求前：

```js
const tools = await runtime.getCurrentTools();
```

**不要缓存成 session 初始化时的 immutable snapshot。**

---

# 甚至可以不用 MCP notification

如果你的模型 Agent 本身就是 MCP Client，那么最简单可靠的实现其实可以是：

```text
workspace_discover
       ↓
promote
       ↓
CapabilityChanged
       ↓
Agent Runtime
       ↓
invalidate tool cache
       ↓
next LLM iteration
       ↓
listTools()
       ↓
shell_run 出现
```

也就是说：

> **先把 Runtime 内部 E2E 做通，再考虑 MCP notification 优化。**

因为这能避免你现在陷入：

```text
到底是 server
还是 MCP client
还是模型
```

三方互相甩锅。

---

# 模型“不知道怎么调用”还有第二个问题

你现在说：

> core 里面看到了

这里还需要确认 **`workspace_discover` 的 description 是否真的足够让模型主动使用。**

不要只是：

```text
Search available tools
```

这种描述太弱。

应该明确告诉模型：

```text
Use this tool when the current task requires a capability that is not
present in the currently available tools.

Do not guess unavailable tool names.

Search by capability/task description.

If a suitable tool is found, it will be promoted and become available
in the next model turn.
```

也就是明确形成：

```text
没有能力
   ↓
discover
   ↓
promote
   ↓
下一轮使用
```

模型才比较容易学会这个循环。

---

# 建议不要让模型调用 promote

这一点继续保持。

模型看到：

```text
workspace_discover
```

而不是：

```text
workspace_discover
workspace_promote
workspace_load_module
```

否则模型很容易走成：

```text
discover
 ↓
promote
 ↓
load
```

增加大量无意义决策。

模型只需要知道：

> **“我缺能力 → discover。”**

Runtime 负责：

> **“找到 → promote → refresh tools。”**

---

# 当前任务应该重新定义成 T12-E2E

我建议不要再说：

> “写一个 smoke test。”

而是明确要求：

```text
T12 — Model-driven lazy-load E2E

目标：

真实 MCP server
        ↓
真实 MCP client
        ↓
真实 Agent Runtime
        ↓
真实 LLM

完成：

LLM#1
  ↓
看到 workspace_discover
  ↓
主动调用 workspace_discover
  ↓
discover shell capability
  ↓
promote shell_run
  ↓
capability version +1
  ↓
tools schema refresh
  ↓
LLM#2
  ↓
看到 shell_run
  ↓
调用 shell_run
  ↓
获得结果
  ↓
LLM#3
  ↓
最终回答
```

---

# E2E 必须打印这 6 个关键点

我建议让 Agent 在测试日志中强制输出：

```text
[E2E-1] MODEL_TOOLS_BEFORE
[E2E-2] DISCOVER_CALL
[E2E-3] CAPABILITY_PROMOTED
[E2E-4] MODEL_TOOLS_AFTER
[E2E-5] LAZY_TOOL_CALL
[E2E-6] FINAL_RESPONSE
```

理想日志：

```text
[E2E-1] MODEL_TOOLS_BEFORE
tools=[workspace_list, workspace_status, workspace_discover]

[E2E-2] DISCOVER_CALL
query="execute shell command"

[E2E-3] CAPABILITY_PROMOTED
tool=shell_run
toolSetVersion=2

[E2E-4] MODEL_TOOLS_AFTER
tools=[workspace_list, workspace_status, workspace_discover, shell_run]

[E2E-5] LAZY_TOOL_CALL
tool=shell_run

[E2E-6] FINAL_RESPONSE
...
```

只要：

```text
[E2E-3] 成功
[E2E-4] 没有 shell_run
```

就不用再看模型了。

**问题就是 tools refresh。**

---

# 我建议现在不要提交

目前这个状态：

```text
registry             ✅
dynamic import       ✅
discover             ✅
promote              ✅
capabilitySet        ✅

MCP refresh          ❓
Runtime refresh      ❌/❓
LLM second turn      ❌
actual lazy tool     ❌
```

所以暂时：

> **不要 commit。**

先把 T12 做完。

---

## 可以直接给当前 Agent 这段任务

```text
当前实现不要提交。T12 需要从“代码级 promote 成功”升级为真正的 model-driven E2E。

当前问题已经明确：workspace_discover/promote 能改变 capabilitySet，但当前会话中的可见 tool schema 没有随之更新，因此模型下一轮仍然看不到 shell_run/tmux_run/ssh_session。不要以“重新连接 MCP 后 ListTools 能看到”作为完成标准，因为这属于 session restart，而不是 in-session lazy loading。

请重点检查并实施以下链路：

LLM#1
→ workspace_discover
→ promote(non-core tool)
→ capabilitySet/toolSetVersion 更新
→ MCP/Agent Runtime tool schema refresh
→ LLM#2 必须看到 promoted tool
→ LLM#2 调用该 tool
→ LLM#3 完成任务。

首先检查 MCP SDK 是否支持 tools/list_changed notification；如果支持，正确发送 notification，并同时确认 Agent Runtime 会 invalidate/rebuild 自己的 tool snapshot。不要只依赖 MCP notification，因为 Runtime 可能仍缓存旧 tools。

如果当前架构更适合 Runtime 内部 refresh，则在 promote 后显式触发 capabilityChanged，并确保下一轮 LLM request 重新构建 tools，而不是复用 session 初始化时的 tools snapshot。

workspace_discover 仍然是唯一暴露给模型的 discovery tool，不增加独立 promote/load_module tool。

为 E2E 增加以下强制日志：
[E2E-1] MODEL_TOOLS_BEFORE
[E2E-2] DISCOVER_CALL
[E2E-3] CAPABILITY_PROMOTED
[E2E-4] MODEL_TOOLS_AFTER
[E2E-5] LAZY_TOOL_CALL
[E2E-6] FINAL_RESPONSE

测试必须使用真实 MCP server + MCP client + Agent Runtime + LLM，证明模型实际主动调用 workspace_discover，并在同一个 session 的下一轮实际调用 promoted non-core tool。

只有完整链路通过后，才提交 lazy-load 改动。
```

**我认为现在最值得查的不是 `registry.js` 了，而是 `server.js → MCP client → Agent Runtime → LLM request` 之间的 tool schema 生命周期。** 当前反馈已经很明确地说明：底层 lazy-load 已经不是主要矛盾，真正缺的是 **capability promotion 后的 in-session tool refresh**。

