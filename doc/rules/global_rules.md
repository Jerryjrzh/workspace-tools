# Core Agent Rules (v1.2)

## 核心工作流
- **会话初始化**：新会话先调用 `session_start`，除非运行时明确返回 `session_initialized=true`。workspace 已设置不代表会话已初始化。
- **工具验证**：基于磁盘和工具结果工作，不依赖历史代码片段或推测。
- **最小闭环**：定位 -> 一次读取足够上下文 -> 修改 -> 使用工具内置验证或专项测试。
- **失败处理**：读取结构化 `errorCode`、`status` 和 `nextAction`，禁止无变化地重复失败调用。

## 文件读取纪律
- 已知符号或位置时优先读取明确范围；未知位置时先检索，再读取 300~500 行上下文。
- 根据 `startLine`、`endLine`、`totalLines`、`truncated` 和 `nextStartLine` 决定是否续读。
- 不重复读取已经覆盖的范围；只有结果截断、发生冲突、验证失败或任务需要新证据时才回读。
- `full` 适用于小文件；大文件使用目标范围或连续区间，不做 20 行左右的反复试探。

## 文件修改纪律
- 修改现有文件前必须读取磁盘中的新鲜内容。
- 小范围、唯一匹配使用 `file_patch` 文本替换；匹配不唯一时改用 context 或行操作。
- 已知行范围优先使用 `replace_line`、`insert_line`、`delete_lines`、`replace_lines`。
- 大范围定点修改优先使用 `edit_begin` -> `edit_apply` -> `edit_review` -> `edit_commit`。
- 对已经完整构造、语义连贯的整文件内容，可以使用 `file_write`；工具必须自行备份、原子写入、校验并返回结构化结果，不得仅因超过 50 行要求拆成大量小 patch。
- `file_write` 被拒绝后，只有 `rereadRequired=true` 才重新读取；否则按 `nextAction` 转换操作，不缩小读取窗口反复定位。
- 不顺带重构、格式化或修改与当前任务无关的代码。

## 结果与验证
- 修改成功必须由结构化结果确认，不从 emoji 或自然语言推断。
- 当结果同时满足 `status=committed`、`validation.writeVerified=true`、`rereadRequired=false` 时，不再为确认写入而读取同一文件。
- 当 `rereadRequired=true`、`status=conflict`、语法检查失败或测试失败时，读取最新内容后重新制定修改。
- JavaScript 修改应通过语法检查；工具已返回 `validation.syntaxOk=true` 时无需重复运行同一检查。
- 完成后运行与变更范围匹配的测试或 lint；不要为了流程而执行无关检查。

## 工具调用与 Token 效率
- 连续工具调用前不复述既定计划，不重复输出同义 thinking。
- 工具返回 `nextAction` 时直接推进；没有新增证据时不重新分析相同决策。
- 优先批量执行互不依赖的检索或读取，减少往返。
- 已完成工具步骤在后续上下文中只保留状态、关键结果和必要证据。

## 安全与版本控制
- 修改工具负责备份、原子写入、写后 hash 验证和代码语法检查。
- 编辑事务提交前必须检测源文件版本冲突；冲突时取消 buffer 并重新读取。
- 未经用户明确要求，不创建 git commit，不自动修改 git 配置。

---
*最后更新: 2026-07-17*
