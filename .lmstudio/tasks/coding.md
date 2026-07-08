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

**除非是创建全新文件，否则绝对禁止使用 `file_write` 来修改现有文件！**

### 修改现有代码时，必须且只能使用以下方式：

#### 方式 A：`file_patch` 的 operation 模式（推荐）
```javascript
// ✅ 正确：精确替换指定行
file_patch({
  path: "server.js",
  mode: "context",
  line: 42,
  window: 10,
  old_str: "const start =",
  new_str: "const startLine ="
});
```

#### 方式 B：`file_read_patch_write`（读取+修改+写入）
```javascript
// ✅ 正确：原子操作，适合小范围修改
file_read_patch_write({
  path: "config.js",
  old_str: "timeout: 30",
  new_str: "timeout: 60"
});
```

### 禁止的操作：
```javascript
// ❌ 错误：全文件重写（除非创建新文件）
file_write({ path: "server.js", content: "..." });
```

## 5. Post-Write Validation（写后验证）

每次修改 `.js` 文件后，**必须立即执行语法校验**：

```bash
# 强制流程：
1. 运行 `node -c <file_path>` 检查语法错误
2. 如果报错，立即调用 `file_rollback` 回滚文件
3. 分析错误原因，进行更精确的编辑
4. 重复直到 `node -c` 完美通过
```

### 自动回滚示例：
```javascript
// 修改后必须执行
const { execSync } = require('child_process');
try {
  execSync(`node -c ${filePath}`, { stdio: 'pipe' });
  console.log('✓ Syntax OK');
} catch (error) {
  // 自动回滚并报告
  file_rollback({ path: filePath });
  throw new Error(`Syntax error in ${filePath}: ${error.message}`);
}
```

## 6. Session Management（会话管理）

### 完成重大 Bug 修复后，必须：

1. **立即停止当前对话**
2. 调用 `session_summarize` 记录当前进度
3. **开启一个全新的聊天窗口**
4. 调用 `session_start` 继续

### 原理：
在新会话中，模型的上下文是干净的，它只能通过 `file_read` 从硬盘读取**目前绝对正确**的代码，彻底断绝了它去"抄历史错题本"的可能。

---

## 总结：三道防线

| 防线 | 措施 | 工具 |
|------|------|------|
| 第一道 | 物理隔离 | `session_summarize` + 新会话 |
| 第二道 | 工具限制 | 禁用 `file_write`，强制 `file_patch` |
| 第三道 | 自动校验 | `node -c` + `file_rollback` |

> **记住：控制它的可视范围比告诉它不要犯错要管用得多。**
