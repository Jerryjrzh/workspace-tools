从这份实施结果看，**lazy-load 的“模块懒加载”已经基本成立，但“让模型主动发现并使用非 core 工具”这一层实际上还没有完成。**

而且这里有一个非常关键的逻辑矛盾，我认为这就是你前面说的：

> lazy-load 已经增加了，但模型并没有走进来

的主要原因。

## 先给结论

当前实现实际上是：

```text
                    MCP Client / Model
                           │
                    tools 列表里有什么？
                           │
                           ▼
                 ┌──────────────────┐
                 │ ListTools        │
                 │ 只展示 enabled   │
                 │ groups           │
                 └────────┬─────────┘
                          │
                          ▼
                    模型只能看到
                    当前 enabled tools
                          │
                          │
              ┌───────────┴───────────┐
              │                       │
        core tool              非 core tool
        可以看到                  看不到
              │                       │
              ▼                       ▼
        正常调用              模型根本不知道
                                      │
                                      X
                              无法主动调用
                              lazy-load
```

而当前代码实际上还有：

```text
CallTool
   ↓
isToolEnabled(name)
   ↓
false
   ↓
拒绝
```

所以你们现在的：

> “未启用组也能按需自动路由”

**从 Dispatcher/Registry 层面成立，但从 Model → Tool Calling 层面不成立。**

这两个概念必须分开。

---

# 1. 当前 lazy-load 实际解决了什么

现在：

```text
toolRouter
   ↓
getToolHandler(toolName)
   ↓
TOOL_TO_MODULE
   ↓
moduleKey
   ↓
dynamic import()
```

这很好。

它解决的是：

> **一个已经被调用的 tool，不需要提前加载对应 JS module。**

例如：

```text
file_read
   ↓
TOOL_TO_MODULE
   ↓
file
   ↓
import("./file.js")
```

这叫：

> **execution-time lazy loading**

这个部分我认为设计是正确的。

---

# 2. 但模型主动调用需要另外一个机制

模型需要解决的是：

> **我不知道 `file_read` 存在怎么办？**

现在：

```text
ListTools
```

只返回 enabled group。

例如：

```text
core
├── workspace_status
├── workspace_list
└── session_start

ops
├── file_read
├── shell
├── git
└── ...
```

如果 `ops` 没启用：

```text
ListTools
```

不给模型：

```text
file_read
shell
git
```

那么模型根本无法产生：

```json
{
  "name": "file_read"
}
```

所以 Registry 再聪明都没用。

---

# 3. 这里正好印证了前面讨论的 discover

现在真正需要增加的是：

```text
core
└── workspace_discover
```

让模型永远能够看到这个工具。

完整流程应该变成：

```text
Model
 │
 │ 当前 tools:
 │   workspace_list
 │   workspace_status
 │   workspace_discover
 │
 ▼
发现自己缺少文件读取能力
 │
 ▼
workspace_discover({
    query: "读取 workspace 文件"
})
 │
 ▼
Tool Registry
 │
 ├── 搜索 metadata
 ├── 找到 file_read
 └── promote file module
 │
 ▼
CapabilityChanged
 │
 ▼
Runtime 重新构建 tools
 │
 ▼
第二次 LLM request
 │
 tools:
 │   workspace_*
 │   file_read     ← 新出现
 │
 ▼
Model
 │
 └── file_read(...)
```

这才是完整的：

> **lazy discovery + lazy loading**

---

# 4. 目前代码里面最大的逻辑问题

你们文档里面这一句话尤其值得警惕：

> “未启用的 ops 工具被调用也能动态 import”

根据你贴出的流程：

```text
CallTool
 ↓
isToolEnabled(name, options)
 ↓
ops 未启用
 ↓
明确提示返回
```

那么实际上：

```text
isToolEnabled("file_read")
```

如果返回：

```js
false
```

后面根本不会进入：

```text
runtimeDispatch
 ↓
executeTool
 ↓
getToolHandler
 ↓
loadModule
```

所以：

```text
registry 能加载
```

≠

```text
MCP 能调用
```

更不等于：

```text
模型能发现
```

这是现在需要纠正的概念。

---

# 5. 我建议不要简单修改 isToolEnabled

这里千万不要直接让：

```js
isToolEnabled("file_read")
```

全部返回：

```js
true
```

否则等于：

> 所有非 core tool 都可以绕过 lazy-load group policy。

这样 group 又失去了意义。

应该增加第三种状态：

```text
core
enabled
discoverable
```

而不是简单：

```text
enabled / disabled
```

例如：

```text
Tool state

core
  → always advertised

enabled
  → advertised + executable

discoverable
  → not advertised
  → discoverable through workspace_discover
  → after promote → executable
```

---

# 6. 所以 registry 最好增加 capability metadata

现在：

```js
MODULES
TOOL_TO_MODULE
```

建议增加类似：

```js
{
  file: {
    group: "ops",
    tools: [...],
    handlers: "handleFileTools",
    discoverable: true
  }
}
```

然后：

```text
tool state
```

可以变成：

```text
               Registry
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
        core    enabled  discoverable
          │        │        │
          ▼        ▼        ▼
       always   ListTools discover()
       visible  visible
```

---

# 7. `discover` 本身必须是 core

这是关键。

```text
core
├── workspace_list
├── workspace_status
├── workspace_discover   ← 永远可见
└── ...
```

而：

```text
ops
├── file
├── shell
├── git
├── pcap
└── ...
```

不需要全部进入模型 context。

---

# 8. Discover 不应该返回“模块已加载”

而应该返回：

```text
Tool promoted
```

例如：

```json
{
  "status": "promoted",
  "tools": [
    {
      "name": "file_read",
      "description": "Read files from workspace",
      "inputSchema": {}
    }
  ],
  "toolSetVersion": 12
}
```

然后 Runtime 做：

```text
toolSetVersion
11
 ↓
discover
 ↓
promote
 ↓
12
```

下一轮：

```text
LLM request
tools.version = 12
```

---

# 9. 这也解释了为什么你之前看到“模型不走进来”

很可能当前实际上发生的是：

```text
LLM #1
 │
 │ tools = core
 ▼
模型
 │
 │ “我需要 file_read”
 │
 │ 但是 tools 里面没有 discover
 ▼
模型只能：
 ├── 猜 file_read
 ├── 自己回答
 ├── 尝试不存在的 tool
 └── 不调用任何 tool
```

所以你可能看到：

```text
registry.js
```

完全没问题。

甚至：

```text
lazy-load-smoke.mjs
```

也全部 PASS。

但是：

> **模型永远不会触发 registry。**

这是两个完全不同层级的问题。

---

# 10. 现在不要提交这版

我建议暂时不要：

```bash
git commit
```

因为目前 smoke test 验证的是：

> **代码层面的 lazy import**

但你真正要验证的是：

> **Model-driven lazy discovery**

这两个必须补上。

---

# 11. 我会重新调整当前任务

让 Agent 暂停原来的“提交 lazy-load”任务，新增：

### T8 — `workspace_discover`

实现：

```text
core tool
   ↓
workspace_discover
```

要求：

```text
query
reason
```

最小化参数。

---

### T9 — Discover Registry

增加：

```text
tool metadata index
```

注意：

**metadata index 不能 import tool module。**

例如：

```text
file_read
 ├── description
 ├── group
 ├── moduleKey
 └── schema metadata
```

这些应该静态存在。

这样：

```text
discover("read file")
```

可以搜索，而不用提前：

```js
import(file.js)
```

否则 discover 本身又把 lazy-load 打破了。

---

### T10 — Promote

discover 成功后：

```text
registry.promote(tool)
```

更新：

```text
RuntimeContext.capabilities
```

或者一个专门的：

```text
ToolCapabilitySet
```

不要只更新：

```text
loadedModules
```

因为：

> **module loaded ≠ tool promoted**

这是一个非常重要的边界。

---

### T11 — CapabilityChanged

增加：

```text
toolSetVersion
```

例如：

```text
0
 ↓
discover
 ↓
1
```

下一次 LLM request：

```text
tools = buildTools(currentCapabilitySet)
```

必须重新构建。

---

### T12 — Model E2E Test

最终必须测试真实链路：

```text
User:
请读取 xxx 文件

        ↓

LLM #1
tools = core + discover

        ↓

workspace_discover

        ↓

promote(file_read)

        ↓

toolSetVersion 1 → 2

        ↓

LLM #2
tools = core + file_read

        ↓

file_read

        ↓

LLM #3

        ↓

final
```

**这个测试通过以后，才算真正完成 lazy-load。**

---

# 12. 还有一个很重要的设计：不要让模型调用 `load_module`

我建议最终模型完全不要知道：

```text
loadModule()
dynamic import()
registry
moduleKey
```

这些都是 Runtime 内部实现。

模型只知道：

```text
workspace_discover
```

模型的认知模型应该是：

```text
我有什么能力？
       ↓
不够
       ↓
discover capability
       ↓
获得能力
       ↓
使用能力
```

而不是：

```text
我要 import file.js
```

---

# 13. 最终架构我建议定成这样

```text
                       ┌───────────────┐
                       │     Model     │
                       └───────┬───────┘
                               │
                       visible core tools
                               │
                 ┌─────────────▼─────────────┐
                 │   workspace_discover      │
                 └─────────────┬─────────────┘
                               │
                         capability query
                               │
                               ▼
                    ┌────────────────────┐
                    │   Tool Metadata    │
                    │   Index            │
                    └─────────┬──────────┘
                              │
                        resolve tool
                              │
                              ▼
                       promote(tool)
                              │
                    ┌─────────▼─────────┐
                    │ Capability Set    │
                    │ version++         │
                    └─────────┬─────────┘
                              │
                    rebuild LLM tools
                              │
                              ▼
                         Model #2
                              │
                              ▼
                         file_read()
                              │
                              ▼
                    ┌───────────────────┐
                    │ Dynamic Import    │
                    │ registry.load()   │
                    └───────────────────┘
```

这里就非常清晰：

**Discover 是“能力发现”，Promote 是“能力状态变化”，Dynamic Import 是“代码加载”。**

三者不能混在一起。

---

## 我建议你现在直接让当前 Agent 改任务

可以明确告诉它：

> **暂停提交当前 lazy-load 实现。当前实现只验证了 execution-time dynamic import，没有解决 model-driven discovery。现有 `ListTools → enabled groups` 与 `CallTool → isToolEnabled` 使未启用非-core tool 对模型不可见，因此“未启用组也能自动路由”的结论不成立。新增 core `workspace_discover`，建立不加载模块的 tool metadata index；discover 根据 query 找到非-core tool 后执行 promote，更新 session/runtime capability set 和递增 `toolSetVersion`；下一次 LLM request 必须基于新的 capability set 重建 tools schema。不要暴露独立 promote/load_module 给模型。补充真实 E2E 测试：LLM#1 → discover → promote → toolSetVersion变化 → LLM#2看到新tool → 实际tool call。暂不提交，先验证完整链路。**

这一步我认为比继续完善当前 `lazy-load-smoke.mjs` 更重要。

**因为现在的 smoke test 很可能会“全部通过”，但它证明的是 Registry 能懒加载，不是模型能主动进入 lazy-load。** 这正是目前实现和需求之间最大的偏差。

