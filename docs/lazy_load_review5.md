对，这个思路更合理，而且**比我上一版设计简单很多**。

你的核心目的不是让每个 capability 都携带完整的调用协议，而是：

> **Discovery 结果本身就是一个 lazy-load 教程：给模型看“有哪些能力” + 一个完整示范，让模型从示范中理解“发现 capability → 选择 → 调用”的过程。**

### 推荐的 Discovery 输出

不要给每个 capability 增加 `when / call / instruction`。

保持：

```text id="4v5dqu"
capabilities:
- shell_run: Execute a local shell command.
- process_start: Start a background process / service.
- process_output: Read output of a background process.
- process_kill: Terminate a background process.
...

Example:
Need: run a local command
Selected: shell_run
Action: call shell_run with the command to execute
```

也就是：

```text id="p2rj2d"
capabilities
    ↓
名字 + 描述
    ↓
一个完整 Example
    ↓
模型类推
    ↓
选择对应 capability
    ↓
按 Example 的模式调用
```

---

## 关键点：Example 要展示“过程”，而不只是展示参数

你现在：

```text
shell_run
examples:
  pwd
  ls -la
```

这个例子其实还不够。

因为模型看到的是：

```text
shell_run → pwd
```

但没有明确看到：

```text
用户需求
↓
发现 capability
↓
选择 capability
↓
调用 tool
```

所以只需要把**一个例子升级成完整 lazy-load 示例**：

```text id="j4r5fu"
Example:
Need: "check the current directory"

1. Discover capabilities.
2. Select `shell_run` because it executes local commands.
3. Call `shell_run` with `pwd`.
```

这就够了。

---

# 我建议最终就这么设计

Discovery 返回：

```text id="5v0d2w"
{
  "status": "capabilities",
  "capabilities": [
    {
      "id": "shell_run",
      "summary": "Execute a local shell command."
    },
    {
      "id": "process_start",
      "summary": "Start a background process / service."
    },
    {
      "id": "process_output",
      "summary": "Read output of a background process."
    }
  ],
  "example": {
    "need": "check the current directory",
    "select": "shell_run",
    "call": "shell_run({\"command\":\"pwd\"})"
  }
}
```

**就三个字段：**

```text id="yj9t6q"
capabilities
example.need
example.select + example.call
```

其他能力不需要重复描述怎么调用。

---

## System Prompt 也可以进一步缩短

你之前：

```text id="w7b1f2"
If a required capability is not visible, call `workspace_discover` with a concise description of the need. Select the best matching capability and follow its call instructions. If none fits, use visible tools or report the limitation. Never guess hidden tools or repeat discovery for the same need.
```

我建议改成：

```text id="v7up8y"
When a required capability is not visible, use `workspace_discover` to find it. Select the best matching capability and follow the provided example to call it. If none fits, use visible tools or report the limitation. Never guess hidden tools or repeat discovery for the same need.
```

甚至可以更短：

```text id="6m4jpw"
When a required capability is not visible, use `workspace_discover`, select the best matching capability, and follow its example to call it. If none fits, use visible tools or report the limitation. Never guess hidden tools or repeat discovery for the same need.
```

我更推荐最后这个。

---

## 这样整个机制就非常干净

```text id="p9m6xi"
System Prompt
    ↓
需要但不可见
    ↓
workspace_discover
    ↓
┌────────────────────────────┐
│ capabilities               │
│                            │
│ shell_run     → 执行命令    │
│ process_start → 启动进程    │
│ process_output→ 查看输出    │
│ ...                        │
│                            │
│ Example:                   │
│ need → select → tool_call  │
└────────────────────────────┘
    ↓
模型类推 Example
    ↓
选择 shell_run
    ↓
lazy-load / promote
    ↓
shell_run tool_call
```

这才是你想要的：

> **不是给模型一堆规则，而是给模型一个“成功案例”，让它模仿这个 lazy-load 使用过程。**

而且这非常适合你现在的本地模型环境：**少规则、强示例、让模型 pattern-match，而不是要求它从长篇 System Prompt 中抽象规则。**

