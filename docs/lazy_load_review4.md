整体方向**符合预期，而且核心判断是对的**。不过我建议实施前再做几处调整，否则容易把“Discovery 改造”做成另一个复杂的工具调用链。

### 我建议确认 4 个关键点

**1. P1/P2 是当前真正的一号问题，成立。**

当前证据链：

```text
discover × 3
    ↓
no_match × 3
    ↓
toolSetVersion = 0
    ↓
promote = 0
    ↓
lazy-load = 0
```

因此现在确实不应该优先排查 schema refresh。**连 promote 都没发生，refresh 没有测试前提。**

---

**2. P3 “Capability Registry 缺失”建议措辞稍微保守。**

目前日志能证明的是：

> Discovery 没有返回可供模型选择的 capability set。

但仅凭会话日志，**不能完全证明代码里不存在 Capability Registry**。

所以建议改成：

> **P3. Discovery 缺少面向模型的 Capability Catalog / Registry 输出**

而不是直接断言“Capability Registry 缺失”。

这样实施时也不会误删已有的 `registry.js`——当前的 `registry.js` 很可能只是：

```text
toolName → module → handler
```

它解决的是**运行时加载路由**，不是：

```text
capability → available tools → help
```

这两个 Registry 应该明确区分。

---

**3. T5 Promote 可以保留，但不要把它暴露成复杂的模型流程。**

你现在写：

```text
discover
→ select
→ promote
→ version++
→ next turn
```

作为**内部 Runtime 状态机**完全正确。

但 System Prompt 不需要告诉模型这么多实现细节。

你前面确定的一句话版本反而更好：

```text
## Tool Discovery

When a required capability is not visible, use `workspace_discover` to inspect available capabilities, choose the most appropriate tool, and use it in the next turn; never guess hidden tools or repeatedly search for the same capability.
```

这里不必出现 `promote`。

模型只需要知道：

```text
discover → choose → next turn use
```

至于 Runtime 内部是不是叫 promote、activate、inject，都不应该成为模型协议的一部分。

---

**4. T8 的 E2E 需要稍微调整。**

你现在写：

```text
Turn1:
discover
→ CAPABILITY_LIST
→ select shell_run
→ PROMOTE
→ version=1
```

这里实际上把两个模型动作压在一个 Turn 里了。

如果 `workspace_discover` 返回能力集后，模型才看到：

```text
shell_run
tmux_run
ssh_session
```

那么模型必须**下一次 tool call**才能选择：

```text
shell_run
```

因此真正的 E2E 更应该是：

```text
Turn 1
LLM
  ↓
workspace_discover({need:"execute pwd"})
  ↓
Runtime
  ↓
CAPABILITY_LIST
  ├─ shell_run
  ├─ tmux_run
  └─ ssh_session


Turn 2
LLM
  ↓
选择 shell_run
  ↓
Runtime promote
  ↓
toolSetVersion++


Turn 3
LLM
  ↓
看到完整 shell_run schema
  ↓
shell_run({command:"pwd"})


Turn 4
LLM
  ↓
回答目录
```

如果你们最终设计成“Discovery 返回能力集，同时允许模型在同一个 tool call 中指定选择”，那才可以压缩成 3 Turn。但**按照目前你提出的“像 help 一样让模型自己选择”这个设计，我更推荐上面的 4-step E2E。**

---

# 还有一个重要调整：T2 的 metadata 不要过度设计

你现在：

```js
{
  name,
  capability,
  summary,
  whenToUse: [],
  examples: []
}
```

方向正确。

但第一版建议只保留：

```js
{
  name: "shell_run",
  summary: "Execute a local shell command",
  usage: "Run one-shot local commands such as pwd, ls, grep...",
  examples: ["pwd", "ls -la"]
}
```

先不要建立复杂 taxonomy：

```text
capability hierarchy
semantic embedding
intent classifier
fuzzy matcher
...
```

因为 Discovery 的职责已经改变了：

> **它不是帮模型匹配工具，而是把候选能力告诉模型。**

所以第一版甚至不需要很强的语义搜索。

可以简单：

```text
need = "execute pwd"
        ↓
Capability Catalog
        ↓
terminal/shell category
        ↓
返回 shell_run / tmux_run / ssh_session
```

甚至最初可以直接按 capability group 返回。

---

# P6 我建议暂时从“核心问题”降级

你写：

> Core tools 过多 → 降低进入 lazy-load 的动机。

**这个推断目前没有这份日志直接证明。**

因为实际情况恰恰是：

```text
模型已经发现自己缺 shell
→ 主动调用 discover
```

所以 Core 数量并没有阻止它进入 Discovery。

它只是可能影响后续工具选择和 context 大小。

因此建议标成：

> **P6. Core tool surface 偏大，作为后续优化项；目前不是 lazy-load 未触发的根因。**

这样能避免 Agent 接下来又跑去大规模精简 core，偏离当前主线。

---

# 我建议最终任务计划改成这个版本

```text
P0
修复 Discovery 语义

query/search
      ↓
need
      ↓
Capability Catalog
      ↓
返回候选能力
```

### T1

重构 `workspace_discover`

```text
输入：need
输出：capabilities[]
```

不自动选择、不自动 promote。

### T2

建立/补齐 **Capability Catalog**

注意：

```text
Tool Runtime Registry
    ≠
Capability Catalog
```

前者：

```text
shell_run → shell.js
```

后者：

```text
shell_run
  → Execute local shell commands
  → pwd / ls / grep
  → example
```

### T3

Discovery 去掉：

```text
no_match
retry hint
```

改成：

```text
capabilities[]
```

或者：

```text
empty
```

### T4

模型根据 capability set 自己选择。

### T5

Runtime 根据模型选择执行 promote / activation。

### T6

验证：

```text
Turn N
shell_run 不在 tools

↓

discover

↓

Turn N+1
出现候选能力

↓

select

↓

Turn N+2
shell_run 完整 schema 出现

↓

shell_run()
```

### T7

最后再改 System Prompt。

### T8

最后跑完整 E2E。

---

## 最终判断

你的计划**整体可以进入实施**，我只建议做这几个修正：

| 项目                 | 当前判断    | 建议                           |
| ------------------ | ------- | ---------------------------- |
| P1 Discovery API   | ✅ 核心问题  | 保留                           |
| P2 no_match 循环     | ✅       | 保留                           |
| P3 Registry 缺失     | ⚠️ 证据不足 | 改成“缺少 Capability Catalog 输出” |
| P4 Prompt searcher | ✅       | 后置修改                         |
| P5 query 命名        | ✅       | 改 `need`                     |
| P6 core 太多         | ⚠️      | 降级为后续优化                      |
| T1-T3              | ✅       | **第一优先级**                    |
| T4 Select          | ✅       | 第二阶段                         |
| T5 Promote         | ✅       | Runtime 内部保留                 |
| T6 Refresh         | ✅       | **必须等 promote 真正发生后验证**      |
| T7 Prompt          | ✅       | 后置，而且保持简短                    |
| T8 E2E             | ⚠️      | 按真实多轮 tool-call 拆开           |

**最重要的一点：不要再把 `workspace_discover` 做成“智能搜索器”。**

你现在确定的模型应该是：

```text
当前工具
   ↓
缺能力
   ↓
workspace_discover
   ↓
能力帮助页
   ↓
模型理解 + 选择
   ↓
Runtime activate/promote
   ↓
下一轮完整工具
   ↓
执行
```

这个架构和你想要的“像命令 `help` 一样”是一致的，而且比当前的 `query → match → promote` 更适合后面继续扩展几十甚至上百个工具。

