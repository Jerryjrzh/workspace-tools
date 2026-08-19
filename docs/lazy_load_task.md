我已完整阅读了 `docs/lazy_load_review3.md`（982 行）。下面依据该文档列出明确的问题点和修复计划。

## 一、问题点清单

### P1. Discovery API 设计错位（核心问题）
- **现状**：`workspace_discover(query)` 被实现为"关键词搜索器"，返回 `no_match` + hint，诱导模型反复换关键词。
- **证据**：会话中 `discover × 3 → no_match × 3 → toolSetVersion = 0 × 3 → promote = 0 → lazy-load = 0`。
- **根因**：Discovery 回答的是"你的 query 匹配到哪个工具"，而不是"当前还有哪些能力可用"。

### P2. `no_match` + hint 驱动模型兜圈子
- **现状**：返回 `{"status":"no_match","hint":"可尝试更宽泛的关键词..."}`，明确诱导模型重复调用。
- **后果**：产生三次换关键词的循环（执行 shell → shell 终端命令执行 → bash 命令执行工具）。
- **结论**：这不是模型"不主动"，而是 Runtime 返回结果在驱动它兜圈子。

### P3. Capability Registry 缺失
- **现状**：很可能没有以 capability 为中心建立注册表，导致 Discovery 无数据源可返回能力集。
- **后果**：无法返回 `capabilities[]`，模型无从选择工具。

### P4. System Prompt 把模型定位成 searcher
- **现状**：prompt 写的是 "Do NOT guess unavailable tool names — search by capability/task description..."，诱导模型做关键词搜索。
- **注意**：文档强调这**不是当前第一修复点**（模型已成功进入 Discovery），但需要随架构一起改。

### P5. `query` 参数命名天然诱导"search"
- **现状**：参数名 `query` → 语义是"我应该搜什么关键词"，而非"我缺什么能力"。
- **建议**：改名 `need`，语义变为"我缺什么能力？"

### P6. Core tools 过多
- **现状**：模型第一轮被塞入大量 core tools（workspace_set/file_*/git_*等），导致模型认为"已有足够工具"，而非"需要隐藏能力"。
- **后果**：降低进入 lazy-load 的动机。

## 二、修复计划

### T1 — Discovery API 重构
把 `query → best match` 改成 `need → capability set`：
```json
{ "need": "执行 pwd 确认当前目录" }
```
返回能力集而非单一匹配，**绝对不要自动 promote**。

### T2 — Capability Registry（Discovery 的真正数据源）
每个 lazy tool 增加元数据：
```js
{
  name: "shell_run",
  capability: "local shell command execution",
  summary: "Execute one local shell command",
  whenToUse: ["pwd", "ls", "grep", "cat", "git commands"],
  examples: ["pwd", "ls -la"]
}
```

### T3 — Discovery 返回能力集（去掉 `no_match`）
- **删除** `{"status":"no_match"}`，改为：
```json
{ "status": "capabilities", "items": [...] }
```
或空时：
```json
{ "status": "empty", "message": "No additional capabilities are available." }
```

### T4 — 模型选择（Model Select）
模型根据返回的能力集自行判断选 `shell_run`，Runtime 不替模型猜。

### T5 — Promote（保留此概念）
```
discover → 看到 shell_run → select → promote → toolSetVersion++ → 下一轮完整 schema
```

### T6 — Schema Refresh 验证
验证 Turn N 无 `shell_run`、Turn N+1 有 `shell_run`。**当前不要改 Jinja/DSML，等真正出现 promote + version=1 后再排查。**

### T7 — System Prompt 随架构改（非第一优先级）
改成 **Discover → Select → Promote → Use**：
```
1. Call workspace_discover, describe the capability you need.
2. Discovery returns a set of capabilities; it does not choose for you.
3. Compare and select the most appropriate tool.
4. Promote the selected tool.
5. The promoted tool becomes visible next turn.
6. Use it in that next turn.

Do not guess hidden tool names.
Do not repeatedly search with different keywords.
```

### T8 — 最小 E2E 测试（不要一开始测全量）
只测一条链路：
```
用户: "通过 pwd 确认当前目录"
Turn1: discover({need:"execute pwd"}) → CAPABILITY_LIST(shell_run/tmux_run/ssh_session)
       → select shell_run → PROMOTE → version=1
Turn2: visible = workspace_discover + shell_run → shell_run({command:"pwd"})
Turn3: 回答目录
```

## 三、优先级排序（文档明确强调）

| 优先级 | 任务 |
|---|---|
| **第一** | T1/T2/T3 — Discovery API 重构 + Registry + 返回能力集（核心） |
| 第二 | T4/T5/T6 — Select/Promote/Schema Refresh |
| 第三 | T7 — System Prompt 改造 |
| ⚠️ 不要做 | 继续增强模型 reasoning、改 Jinja tool-call 格式、围绕 MCP E2E/notification 兜圈子 |

**核心结论**：当前 lazy-load = 0%，根因是 Discovery API 形态错误（返回 `no_match` 而非能力集），而不是模型不主动。先把 `workspace_discover` 从"自动匹配工具"改成"返回能力帮助页，由模型选择"，下一轮实验应观察的 4 个事件是：**discover → capabilities[] → select → promote**。

---

需要我进一步查看当前代码实现（如 discovery 相关源码、Capability Registry 是否存在）来落地这些修复吗？


---

## T7 — System Prompt 对比与优化（review4）

### 当前 System Prompt（运行时注入的一句话版本）
```text
When a required capability is not visible, use `workspace_discover` to inspect available capabilities, choose the most appropriate tool, and use it in the next turn; never guess hidden tools or repeatedly search for the same capability.
```

### 与代码实现（T1-T3 + T5）的对比

| Prompt 内容 | 代码实现 | 匹配度 |
|---|---|---|
| `use workspace_discover` | ✅ `workspace_discover({need})` | ✅ |
| `inspect available capabilities` | ✅ 返回 `capabilities[]`（候选目录） | ⚠️ 未强调"多个候选、不替模型选" |
| `choose the most appropriate tool` | ✅ 模型自己选择（discover 不自动 promote） | ✅ |
| `use it in the next turn` | ⚠️ **模糊**——代码 T5 是"直接调用目标工具名触发 Runtime promote"，prompt 未说明如何"使用/选择" | ⚠️ |
| `never guess / repeatedly search` | ✅ 正确 | ✅ |

### 关键差异（review4 T5：Runtime promote，模型协议不含 select/promote）
- review2/review3 旧版 prompt 有显式 "Request/promote the selected tool"。
- **当前代码已改为 Runtime 自动 promote**：模型在下一轮**直接调用所选工具名**即触发 promote + refresh。
- 因此 System Prompt 应体现 `discover → choose → next turn call`，不再出现显式 select/promote。

### 优化后的 System Prompt（与代码完全对齐）
```text
## Tool Discovery

The visible tools are the tools you can call directly.

When a required capability is not visible:
1. Call `workspace_discover` with `need` describing the missing capability.
2. It returns a candidate set of capabilities (summary/usage/examples) — it does NOT choose for you.
3. Compare and select the most appropriate tool yourself.
4. In your next turn, call that selected tool directly by name; it will be made available automatically.
5. If discovery returns empty or no suitable capability fits, continue with visible tools or report the limitation.

Never guess hidden tool names.
Never repeatedly search with different keywords for the same capability.
```

### 落地说明
- System Prompt 由 LM Studio 运行时注入（不在代码仓库），需在运行时配置中替换。
- `workspace_discover` 工具 description（src/tools/discovery.js）已与上述协议对齐：
  - 输入 `need`
  - 返回候选目录、不自动选择/promote
  - "call the selected tool directly in your next turn"

