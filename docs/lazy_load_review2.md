对，我认为你的这个判断**比当前“query → 自动匹配 → promote”设计更合理**。

当前设计实际上把 `workspace_discover` 做成了一个“语义路由器”，容易出现：

```text
模型：我需要执行 shell
        ↓
discover
        ↓
系统猜测 shell_run
        ↓
匹配成功 → promote
```

这会把**工具选择权放到了 Runtime**，而且一旦匹配算法有偏差，模型根本不知道为什么选了这个工具。

你说的模型应该更像 Unix：

```text
command
   ↓
command --help
   ↓
看到能力、参数、限制、示例
   ↓
用户/模型自己选择正确用法
```

我建议把 Discovery 定义为：

> **Capability Discovery / Tool Help，而不是 Tool Resolver。**

---

# 1. 正确的模型应该是

```text
当前可用工具
      │
      │ 不够
      ▼
workspace_discover
      │
      ▼
返回「能力集」
      │
      ├── shell_run
      ├── tmux_run
      ├── ssh_session
      └── ...
      │
      ▼
模型阅读 description / schema / examples
      │
      ▼
模型选择
      │
      ▼
workspace_promote(tool)
      │
      ▼
下一轮获得完整 tool schema
      │
      ▼
模型调用
```

但这里我会再做一个优化：

**不一定要暴露独立的 `promote` tool。**

可以让 `discover` 返回能力集，然后模型直接请求：

```text
workspace_discover({
    "capability": "shell execution"
})
```

返回：

```json
{
  "status": "available",
  "capabilities": [
    {
      "tool": "shell_run",
      "summary": "Execute a shell command",
      "usage": "...",
      "when_to_use": "...",
      "examples": [...]
    },
    {
      "tool": "tmux_run",
      "summary": "Execute commands in a persistent tmux session",
      "usage": "...",
      "when_to_use": "...",
      "examples": [...]
    },
    {
      "tool": "ssh_session",
      "summary": "Execute commands on a remote SSH session",
      "usage": "...",
      "when_to_use": "...",
      "examples": [...]
    }
  ]
}
```

**注意：这里不做选择。**

Runtime 只是：

> “你有这些能力，请自己判断。”

---

# 2. 这和 `--help` 的类比非常准确

例如 Linux：

```bash
git help
```

不会替你决定：

```text
你应该 git checkout
```

它告诉你：

```text
clone
init
add
commit
checkout
branch
...
```

然后：

```bash
git checkout --help
```

才进一步告诉你：

```text
git checkout [options] <branch>
...
```

对于 Agent，我建议做成**两级 Discovery**。

---

## Level 1：Capability Index

```text
workspace_discover("shell / terminal")
```

返回：

```text
Shell capabilities

1. shell_run
   Execute a one-shot shell command.
   Suitable for: pwd, ls, grep, cat...

2. tmux_run
   Execute commands in a persistent terminal session.
   Suitable for: long-running processes, interactive sessions...

3. ssh_session
   Execute commands on remote hosts.
   Suitable for: remote device administration...
```

模型自己选：

```text
shell_run
```

---

## Level 2：Tool Help

然后模型可以：

```text
workspace_discover({
    "tool": "shell_run",
    "detail": "full"
})
```

得到：

```text
shell_run

Purpose:
  Execute a shell command.

Arguments:
  command: string
  cwd: optional string
  timeout: optional integer

Constraints:
  ...
  
Examples:
  shell_run("pwd")
  shell_run("ls -la")

Not suitable for:
  long-running interactive sessions
```

这就真的像：

```bash
shell_run --help
```

---

# 3. 然后才是 Promote

这里我反而赞成保留一个**Runtime 内部的 promote 概念**：

```text
discover
   ↓
能力集
   ↓
模型选择 shell_run
   ↓
promote(shell_run)
   ↓
完整 schema 注入下一轮
```

但：

> **`promote` 可以是 Runtime control action，不一定是模型直接调用的 tool。**

如果要让模型显式选择，我更倾向于让 `discover` 支持：

```json
{
  "capability": "shell execution",
  "select": "shell_run"
}
```

而不是增加：

```text
workspace_discover
workspace_promote
workspace_load
```

三个工具。

否则工具本身又开始膨胀。

---

# 4. 最重要的是：Discovery 返回“候选能力”，而不是“匹配结果”

当前：

```text
query
 ↓
no_match / promoted
```

我认为这个状态机应该改掉。

改成：

```text
DISCOVER
  │
  ├── capabilities[]
  │
  └── no_capability
```

例如：

```json
{
  "status": "capabilities",
  "capabilities": [
    {
      "id": "shell_run",
      "name": "Shell command execution",
      "summary": "Run a one-shot command locally",
      "usage": "shell_run(command, cwd?, timeout?)"
    },
    {
      "id": "tmux_run",
      "name": "Persistent terminal execution",
      "summary": "Run commands in a persistent tmux session",
      "usage": "tmux_run(session, command)"
    }
  ]
}
```

模型：

```text
用户需要 pwd
 ↓
shell_run
```

然后：

```text
select/promote shell_run
```

---

# 5. 甚至可以让 Discovery 直接返回“轻量 schema”

这是我比较推荐的。

不要返回完整 JSON schema，因为那样可能又把 context 搞得很大。

返回：

```text
shell_run
Purpose:
  Execute one local shell command.

Parameters:
  command: shell command
  cwd: optional working directory
  timeout: optional timeout

Example:
  shell_run({command:"pwd"})
```

模型已经足够判断。

确定之后：

```text
promote(shell_run)
```

下一轮才注入：

```json
{
  "name": "shell_run",
  "description": "...",
  "inputSchema": {...完整 schema...}
}
```

这样才能真正实现：

> **Discovery 本身轻量，真正 Tool Schema 按需加载。**

这和你们现在想做的 lazy-load 是高度一致的。

---

# 6. 这也解决了“随意匹配”的问题

当前模型：

```text
“执行 shell”
```

Runtime：

```text
shell_run
```

这里有一个危险：

如果同时存在：

```text
shell_run
tmux_run
ssh_session
docker_exec
adb_shell
serial_console
```

Runtime 怎么知道哪个正确？

它其实不知道。

**模型知道上下文。**

例如：

> “通过 SSH 登录设备后执行 ifconfig”

Runtime 很难只靠字符串决定。

但模型看到：

```text
shell_run
tmux_run
ssh_session
adb_shell
serial_console
```

以及它们的用途：

```text
ssh_session:
  remote host

adb_shell:
  Android device

serial_console:
  serial-connected device
```

模型就能做正确选择。

所以：

> **Discovery 应该扩大模型的选择空间，而不是替模型做最终选择。**

---

# 7. 这会让 System Prompt 简单很多

当前 prompt 不需要：

```text
If capability is missing...
describe capability...
retry...
```

搞得很复杂。

可以变成非常明确的协议：

```text
## Tool Discovery

The currently visible tools are the tools you can call directly.

If you need a capability that is not visible:
1. Use `workspace_discover` to inspect available capabilities.
2. Do not guess a hidden tool name.
3. Compare the returned capabilities and choose the tool that best fits
   the task.
4. Request/promote the selected tool.
5. On the next turn, use the promoted tool.
6. If no suitable capability exists, continue with available tools or
   report the limitation.
```

这里模型的职责非常清楚：

```text
Discover → Understand → Select → Use
```

Runtime 的职责：

```text
Discover index → Promote → Inject schema → Execute
```

---

# 8. J-Space 反而也更适合这种模式

这和你前面准备接入的 J-Space 很契合。

J-Space 可以负责：

```text
当前任务
 ↓
需要什么能力？
 ↓
Discovery
 ↓
候选能力
 ↓
比较/选择
 ↓
执行
 ↓
验证
```

而 workspace-tools 只负责：

```text
Capability Registry
       ↓
Tool Discovery
       ↓
Tool Promotion
       ↓
Tool Execution
```

这样职责非常干净。

---

# 9. 我建议现在把当前实现改成这个架构

```text
                     ┌──────────────┐
                     │     LLM      │
                     └──────┬───────┘
                            │
                    visible tools
                            │
                     capability missing
                            │
                            ▼
                  workspace_discover
                            │
                            ▼
                 ┌───────────────────┐
                 │ Capability Index  │
                 └─────────┬─────────┘
                           │
                    return capability
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
         shell_run      tmux_run     ssh_session
             │             │             │
             └─────────────┼─────────────┘
                           │
                     Model selects
                           │
                           ▼
                    promote(selected)
                           │
                           ▼
                    toolSetVersion++
                           │
                           ▼
                  next LLM turn
                           │
                           ▼
                  full tool schema
                           │
                           ▼
                     actual call
```

---

# 10. 我甚至建议把 `discover` 分成两个概念

代码层面可以：

```text
CapabilityRegistry
```

提供：

```text
listCapabilities()
getCapability(id)
```

然后：

```text
workspace_discover
```

只是它的 MCP façade。

例如：

```text
workspace_discover()
```

→ 能力目录。

```text
workspace_discover({capability:"terminal"})
```

→ terminal 能力集。

```text
workspace_discover({tool:"shell_run", detail:"full"})
```

→ shell_run help。

这样就完全对应：

```text
command
command help
command subcommand help
```

---

## 最终我赞成你的方向，而且我认为应该明确改掉当前设计中的一个核心假设

当前：

> **Discover = 帮模型找到并自动 promote 一个最匹配的 tool**

建议改成：

> **Discover = 给模型提供当前隐藏能力的“帮助/目录”，模型负责理解和选择；Runtime 负责根据模型选择加载和注入。**

也就是：

```text
❌ Query → 自动匹配 → Promote

✅ Need → Discover → Capability Set → Model Select → Promote → Use
```

这会比当前设计**更可解释、更可控，也更适合工具数量继续增长**。

而且你这个“`help`”类比非常重要：**Discovery 不应该是一个搜索引擎，而应该是 Agent 的动态能力手册。**

