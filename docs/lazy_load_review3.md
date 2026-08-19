我仔细看了这份**完整会话 JSON**，这次可以比较确定地说：

> **兜兜转转没有进入 lazy-load，不是单纯模型“不主动调用”的问题，而是当前 discovery 的设计把模型带进了一个错误的循环：`discover → no_match → 改 query → discover`。**
>
> 整个过程中 **一次 `promote` 都没有发生，`toolSetVersion` 始终是 0**。因此我们之前讨论的“promote 后 schema refresh”在这次会话里实际上根本还没被触发。

证据非常直接：三次 `workspace_discover` 的结果全部是 `no_match`，版本都是 `0`。  

---

# 一、先把整个会话真实流程还原出来

用户只提出：

> 通过调用系统命令 pwd 确认当前目录



模型第一步其实是**正确的**：

```text
LLM
 ↓
workspace_discover
    query = "执行 shell 命令，如 pwd、ls 等"
```



所以第一结论：

### 模型已经知道应该 Discovery

**System Prompt / discover tool 的“入口教育”已经基本成功。**

---

# 二、真正的问题从这里开始

Discovery 返回：

```json
{
  "status": "no_match",
  "message": "未找到匹配 ... 的可发现工具。",
  "toolSetVersion": 0,
  "hint": "可尝试更宽泛的关键词..."
}
```



这里已经出现了第一个非常严重的设计问题：

## Runtime 在告诉模型：

> “你搜索错了，再换一个关键词。”

于是模型开始猜。

第二轮：

```text
shell 终端命令执行
```



仍然：

```text
no_match
toolSetVersion = 0
```



然后第三轮：

```text
bash 命令执行工具
```



仍然：

```text
no_match
toolSetVersion = 0
```



---

# 三、所以整个 lazy-load 实际上是 0%

这点非常重要：

```text
workspace_discover        ✅ 3 次
capability discovery      ❌
candidate returned        ❌
model selection           ❌
promote                   ❌
toolSetVersion++          ❌
dynamic import             ❌
tool schema refresh        ❌
lazy tool execution        ❌
```

因此现在不要再花时间调：

```text
MCP tools/list_changed
AgentRuntime refresh
Jinja 下一轮 schema
```

**这些都是第二阶段的问题。**

第一阶段还没跑通。

---

# 四、当前 Discovery 的根本设计错位

现在 schema 明确告诉模型：

> “Do NOT guess unavailable tool names — search by capability/task description...”



看起来很合理。

但是实际返回机制却是：

```text
query
 ↓
内部匹配
 ↓
匹配不到
 ↓
no_match
 ↓
hint: 换关键词
```

这实际上又把模型变成了：

> **关键词搜索器。**

所以模型自然变成：

```text
执行 shell 命令
 ↓
shell 终端命令执行
 ↓
bash 命令执行工具
```

这正是你刚才说“不符合预期”的地方。

---

# 五、你前面提出的“help”模型，现在看起来是正确方向

我现在会进一步明确：

## Discovery 不应该回答：

```text
“你输入的 query 匹配到了哪个 tool？”
```

而应该回答：

```text
“当前还有哪些能力可以使用？”
```

也就是说：

```text
workspace_discover
```

应该类似：

```bash
help
```

而不是：

```bash
which-command <query>
```

---

# 六、正确的第一次 Discovery 应该长这样

模型：

```text
workspace_discover({
    "query": "执行系统命令 pwd"
})
```

Runtime **不要判断一个最佳匹配**。

直接返回：

```text
Available capabilities:

1. shell_run
   Execute a local shell command.
   Use for: pwd, ls, grep, cat, git, etc.

2. tmux_run
   Execute commands in a persistent terminal session.
   Use for: long-running or interactive commands.

3. ssh_session
   Execute commands on a remote host.
   Use for: SSH-based remote command execution.
```

然后：

```text
模型自己判断：
shell_run
```

这才是：

```text
discover
   ↓
help
   ↓
understand
   ↓
select
```

---

# 七、这里还有一个非常重要的问题：当前 core 太多

从实际 prompt 可以看到，当前模型第一轮已经被塞入了大量 core tools：

```text
workspace_set
workspace_clear
workspace_info
file_read
file_write
file_append
file_patch
file_delete_lines
file_rollback
locate
file_search
glob_search
git_status
git_diff
git_commit
git_branch
git_stash
git_log
context_anchor
workspace_discover
context_load
context_summary
lm_embed
semantic_search
embed_files
lm_review
memory_remember
...
```

例如当前 tool array 从 `workspace_set` 一直展开到 `workspace_discover`、`context_load`、`semantic_search` 等。 

这意味着模型已经面对一个非常大的：

```text
core capability surface
```

再加上：

```text
workspace_discover
```

模型很容易认为：

> “我已经有这么多工具了，先找一个差不多的。”

而不是：

> “我需要的能力不在当前集合 → 查询隐藏能力。”

---

# 八、这次模型其实做出了一个“错误但合理”的退化

三次 discover 都失败以后：

```text
当前环境中没有可用于执行 shell 命令的工具。
```

然后它主动选择：

```text
workspace_info
```



这说明模型的行为逻辑其实是：

```text
我想 pwd
 ↓
找 shell
 ↓
没有
 ↓
那就用 workspace_info
```

从模型角度看，这是合理的。

问题是：

> **Runtime 明明应该告诉它“还有隐藏能力”，却告诉它“没有匹配”。**

所以模型没有任何理由继续进入 lazy-load。

---

# 九、因此第一阶段应该彻底改掉 `no_match`

我甚至建议当前：

```json
{
  "status": "no_match"
}
```

暂时不要存在。

至少在 capability discovery 模式下不要这样。

应该：

```json
{
  "status": "capabilities",
  "items": [...]
}
```

或者：

```json
{
  "status": "help",
  "capabilities": [...]
}
```

如果真的什么都没有：

```json
{
  "status": "empty",
  "message": "No additional capabilities are available."
}
```

而不是：

```text
no_match
try another keyword
```

---

# 十、而且我建议去掉 `query` 这个名字

这是一个小改动，但很重要。

现在：

```json
{
  "query": "执行 shell 命令"
}
```

天然诱导：

> search。

建议：

```json
{
  "need": "执行 pwd 确认当前目录"
}
```

语义变成：

> 我缺什么能力？

不是：

> 我应该搜索什么关键词？

---

# 十一、Discovery 的职责应该变成两步

我建议最终设计：

### 第一步：列能力

```text
workspace_discover
```

参数：

```json
{
  "need": "执行 pwd"
}
```

返回：

```text
Available capabilities:

[shell_run]
Local shell command execution.
Example: pwd, ls, grep...

[tmux_run]
Persistent terminal execution.
For long-running / interactive commands.

[ssh_session]
Remote SSH execution.
For remote hosts.
```

---

### 第二步：模型选择

模型自己决定：

```text
shell_run
```

然后：

```text
workspace_promote
```

或者更简单：

```text
workspace_discover({
    "select": "shell_run"
})
```

最终：

```text
toolSetVersion = 1
promoted = ["shell_run"]
```

---

# 十二、这里我反而建议保留 promote

经过这次日志，我对 promote 的判断有变化。

之前我们考虑：

> 是否不需要 promote，discover 直接加载？

现在我认为：

**应该保留 promote 这个概念。**

因为它非常符合：

```text
help
 ↓
用户选择命令
 ↓
command loaded
```

模型的行为：

```text
discover
 ↓
看到 shell_run
 ↓
选择 shell_run
 ↓
promote shell_run
 ↓
下一轮完整 schema
 ↓
调用 shell_run
```

这比：

```text
discover
 ↓
Runtime 猜 shell_run
```

清晰得多。

---

# 十三、System Prompt 也要随架构一起改

当前 prompt：

> “Do NOT guess unavailable tool names — search by capability/task description instead... If a suitable tool is found, it will be promoted...” 

这实际上把模型定位成：

```text
searcher
```

应该改成：

```text
## Tool Discovery

The visible tools are the tools you can call directly.

When the current task requires a capability that is not visible:

1. Call `workspace_discover` and describe the capability you need.
2. Discovery returns a set of available capabilities/tools. It does not
   choose a tool for you.
3. Compare the returned capabilities with the task and select the most
   appropriate tool.
4. Promote the selected tool.
5. The promoted tool will become visible in the next model turn.
6. Use the promoted tool in that next turn.

Do not guess hidden tool names.
Do not repeatedly search with different keywords.
If discovery returns no suitable capability, continue using visible tools
or report that the capability is unavailable.
```

这个逻辑就非常干净：

```text
Discover → Select → Promote → Use
```

---

# 十四、但 System Prompt 不是当前第一修复点

这一点我要特别强调。

当前模型已经：

```text
workspace_discover
workspace_discover
workspace_discover
```

所以不要继续：

```text
❌ 加强 prompt
❌ 加 promote 提示
❌ 增加“必须调用 discover”
❌ 加更多 reasoning
```

**现在 prompt 已经把模型送到 Discovery 入口了。**

问题是：

```text
Discovery 返回错误形态
```

---

# 十五、还有一个我认为必须马上修的地方：不要把错误的 Hint 返回给模型

当前：

```json
{
  "status": "no_match",
  "hint": "可尝试更宽泛的关键词，如 shell / tmux / ssh"
}
```

这实际上是**明确诱导模型重复调用**。

所以才产生：

```text
第一次：
执行 shell 命令

第二次：
shell 终端命令执行

第三次：
bash 命令执行工具
```

这不是模型自己“兜圈子”，而是 Runtime 的返回结果在驱动它兜圈子。

### 这个 Hint 应该直接删除。

改成：

```text
Discovery returned available capabilities.
Select one if appropriate.
```

或者如果真为空：

```text
No additional capabilities are currently available.
Do not retry discovery for the same request.
```

---

# 十六、当前真正需要实现的 E2E 应该缩小到一个极小测试

不要一开始测：

```text
shell
tmux
ssh
J-Space
MCP notification
```

只测：

```text
用户：
通过 pwd 确认当前目录
```

期望：

```text
Turn 1

Visible:
workspace_discover

LLM:
workspace_discover({
    need: "execute pwd"
})

Runtime:
CAPABILITY_LIST
  shell_run
  tmux_run
  ssh_session

LLM:
select shell_run

Runtime:
PROMOTE shell_run
toolSetVersion = 1

Turn 2

Visible:
workspace_discover
shell_run

LLM:
shell_run({
    command: "pwd"
})

Turn 3

LLM:
回答目录
```

只要这条跑通：

> **lazy-load 的核心机制才算真正成立。**

---

# 十七、还有一个潜在问题：你当前的 Jinja template 不需要现在改

我检查了实际模板。

它确实会把：

```jinja
tools
```

遍历后拼到：

```text
### Available Tool Schemas
```

里。

而且 tool call 输出格式也已经明确支持：

```text
<｜DSML｜tool_calls>
<｜DSML｜invoke ...>
```



所以：

### 当前不要修改 DSML Jinja tool-call 格式。

等真正出现：

```text
promote
toolSetVersion = 1
```

以后，再验证：

```text
Turn 2 prompt
↓
### Available Tool Schemas
↓
shell_run
```

如果那里没有 `shell_run`，才进入 Jinja / Runtime refresh 排查。

---

# 十八、当前任务顺序我建议彻底调整

现在不要继续之前的 T12。

应该改成：

### T1 — Discovery API 重构

```text
query
   ↓
need
```

从：

```text
query → best match
```

改成：

```text
need → capability set
```

---

### T2 — Capability Registry

每个 lazy tool 增加：

```js
{
  name,
  capability,
  summary,
  whenToUse,
  examples,
  limitations
}
```

例如：

```js
{
  name: "shell_run",
  capability: "local shell command execution",
  summary: "Execute one local shell command",
  whenToUse: [
    "pwd",
    "ls",
    "grep",
    "cat",
    "git commands"
  ],
  examples: [
    "pwd",
    "ls -la"
  ]
}
```

**这部分是 Discovery 的真正数据源。**

---

### T3 — Discovery 返回能力集

绝对不要自动 promote。

```text
discover
 ↓
capabilities[]
```

---

### T4 — Model Select

模型根据能力集选择：

```text
shell_run
```

---

### T5 — Promote

```text
shell_run
 ↓
toolSetVersion++
```

---

### T6 — Schema Refresh

验证：

```text
Turn N:
shell_run 不存在

Turn N+1:
shell_run 存在
```

---

### T7 — 真正 LLM E2E

最后才验证：

```text
用户 → discover → select → promote → shell_run
```

---

# 最后给这份日志下一个非常明确的诊断

| 环节                  | 当前状态 | 结论                                     |
| ------------------- | ---- | -------------------------------------- |
| 模型理解任务              | ✅    | 正常                                     |
| 模型主动 Discovery      | ✅    | **已经成功**                               |
| Discovery API       | ❌    | **核心问题**                               |
| Capability Registry | ❓    | 很可能没有以 capability 为中心建立                |
| 返回能力集               | ❌    | 当前没有                                   |
| 模型选择工具              | ❌    | 因为没有候选集                                |
| Promote             | ❌    | 一次都没有                                  |
| toolSetVersion      | ❌    | 始终 `0`                                 |
| lazy module load    | ❌    | 尚未发生                                   |
| schema refresh      | ❌    | 尚未进入测试条件                               |
| Jinja tool call     | ✅    | 当前无需改                                  |
| System Prompt       | ⚠️   | 需要改成 Discover → Select → Promote → Use |
| 模型 reasoning        | ⚠️   | **不是当前问题，不要继续增强**                      |

最关键的证据就是：

```text
workspace_discover × 3
        ↓
no_match × 3
        ↓
toolSetVersion = 0 × 3
        ↓
promote = 0
        ↓
lazy-load = 0
```



所以这次我建议**不要再让 Agent 围绕 MCP E2E、notification、schema refresh 继续兜圈子**。先把 `workspace_discover` 从“**自动匹配工具**”改成“**返回能力帮助页，由模型选择**”。

这一步一旦正确，下一轮日志应该首先出现一个非常明确的变化：

```text
workspace_discover
    ↓
{
  capabilities: [
    shell_run,
    tmux_run,
    ssh_session
  ]
}
```

然后模型才有可能真正走进：

```text
select shell_run
→ promote
→ next turn
→ shell_run
```

**这才是我们下一次实验真正应该观察的 4 个事件，而不是再看模型有没有调用 discover。**

