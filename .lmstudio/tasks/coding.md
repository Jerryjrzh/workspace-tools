# Defensive Coding Constraints (防篡改红线)

## 1. Preserver Existing Logic（保留现有逻辑）

当被要求添加新功能或修复特定行时，**不要修改、重新格式化或"清理"周围的代码。**

- ✅ 只触及与当前任务直接相关的行
- ❌ 禁止顺手修改无关的代码块
- ❌ 禁止"顺便"重构邻近代码

## 2. Beware of Regressions（警惕回归）

不要盲目信任聊天历史中的代码，因为它可能包含过时的语法错误（例如转义错误 `\\n`、缺少 `}` 或 `catch` 块）。

- ✅ 总是基于从磁盘直接读取的**新鲜内容**进行编辑
- ✅ 修改前使用 `file_read` 获取最新状态
- ❌ 不要依赖历史记录中的代码片段

## 3. No Double Escaping（禁止双重转义）

在 JavaScript 中生成字符串模板（`` ` ``）时，不要过度转义标准换行符（`\n`）。

```javascript
// ❌ 错误：双重转义
const template = "line1\\nline2";

// ✅ 正确：单层转义或使用模板字面量
const template = `line1\nline2`;
```

## 4. CRITICAL TOOL RULE（关键工具规则）

**除非创建新文件或用户明确要求整文件替换，否则不要使用 `file_write` 修改现有文件。**

### 修改现有代码时按范围选择方式

- 小范围唯一文本：使用 `file_patch` 的 `old_str/new_str`。
- 已知行位置：使用 `replace_line`、`insert_line`、`delete_lines` 或 `replace_lines`。
- 大范围或多处关联修改：使用 `edit_begin` -> `edit_apply` -> `edit_review` -> `edit_commit`。
- 匹配返回 `MATCH_NOT_UNIQUE` 时必须缩小上下文或改用行操作，不得强行全局替换。
- 返回 `PATCH_TOO_LARGE` 时按 `nextAction` 改用编辑事务；除非 `rereadRequired=true`，不得重新缩小窗口读取，也不得拆成缺乏语义关联的大量盲目 patch。
- 对已完整生成且需要整体替换的内容，允许使用具备备份、原子写入、hash 与语法验证的 `file_write`，不以固定 50 行阈值强制拆分。

## 5. Post-Write Validation（写后验证）

- 优先使用修改工具返回的 `validation` 结果。
- 当 `validation.writeVerified=true` 且 `validation.syntaxOk=true` 时，不重复读取文件或重复执行同一语法检查。
- 当验证失败时，工具应自动回滚；随后读取最新磁盘内容，分析错误并进行更精确的修改。
- 修改完成后运行与变更相关的测试或 lint，不执行无关验证。

## 6. Session Management（会话管理）

- 新会话先执行 `session_start`，除非运行时明确报告会话已初始化。
- 重大修复后记录持久化摘要或检查点，但不强制中断仍可正常推进的当前会话。
- 历史上下文与磁盘内容冲突时，以新鲜磁盘内容为准。
- 工具返回冲突状态时重新读取目标文件，不通过开启新会话规避状态问题。

---

## 总结：三道防线

| 防线 | 措施 | 工具 |
|------|------|------|
| 第一道 | 物理隔离 | `session_summarize` + 新会话 |
| 第二道 | 工具限制 | 禁用 `file_write`，强制 `file_patch` |
| 第三道 | 自动校验 | `node -c` + `file_rollback` |

> **记住：控制它的可视范围比告诉它不要犯错要管用得多。**
