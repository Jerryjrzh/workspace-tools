// src/tools/file.js
import { workspaceManager } from '../managers/workspace.js';
import { ToolMiddleware } from '../utils/middleware.js';
import fs from 'fs';
import path from 'path';

// Backup directory constant
const BACKUP_DIR = '.lmstudio-backups';

// Buffer pool to store file contents for edit transactions
const bufferPool = new Map();
let nextBufferId = 1;

/**
 * Create a backup of a file before modification
 * @param {string} filePath - Path to the file to backup
 * @param {Object} context - Session context containing workspace
 * @returns {string|null} - Path to the backup file, or null if no backup needed
 */
function backupFileBeforePatch(filePath, context) {
  try {
    if (!fs.existsSync(filePath)) return null; // No backup needed for new files
    
    const ws = context.workspace || workspaceManager.getWorkspace() || process.cwd();
    const backupDirPath = path.join(ws, BACKUP_DIR);
    
    if (!fs.existsSync(backupDirPath)) {
      fs.mkdirSync(backupDirPath, { recursive: true });
    }
    
    // Generate timestamped backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const backupPath = path.join(backupDirPath, `${fileName}_${timestamp}.bak`);
    
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (e) {
    console.error(`[Backup Failed] Cannot backup file ${filePath}:`, e.message);
    return null; // Don't fail if backup fails
  }
}

// ============================================================
// Release Guard - Safe Write Pipeline (V1.5 部署稳定器)
// ============================================================

/** Maximum allowed diff lines for a single modification */
const MAX_DIFF_LINES = 50;

/**
 * Calculate the number of changed lines between old and new content
 * @param {string} oldContent - Original file content
 * @param {string} newContent - New file content  
 * @returns {number} Number of changed lines
 */
function calculateDiffLines(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let diffCount = 0;
  
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      diffCount++;
    }
  }
  
  return diffCount;
}

/**
 * Run syntax/compile check on a file based on its extension
 * @param {string} filePath - Path to the file to check
 * @returns {Promise<void>} Resolves if check passes, rejects with error message
 */
async function runCompileCheck(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Only check JavaScript/TypeScript files (most critical for syntax errors)
  if (!['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
    return; // No compile check needed for other file types
  }
  
  try {
    const { execFile } = await import('child_process');
    
    // For .js/.mjs files, use node --check
    if (['.js', '.mjs'].includes(ext)) {
      return new Promise((resolve, reject) => {
        execFile('node', ['--check', filePath], { timeout: 10000 }, (err) => {
          if (err) {
            reject(new Error(`Node syntax check failed for ${filePath}: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
    
    // For .cjs files, use node --check with explicit module type
    if (ext === '.cjs') {
      return new Promise((resolve, reject) => {
        execFile('node', ['--check', filePath], { 
          timeout: 10000,
          env: { ...process.env, NODE_OPTIONS: '--input-type=commonjs' }
        }, (err) => {
          if (err) {
            reject(new Error(`Node syntax check failed for ${filePath}: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
    
    // For .ts files, use tsc --noEmit if available
    if (ext === '.ts') {
      return new Promise((resolve, reject) => {
        execFile('npx', ['tsc', '--noEmit', filePath], { 
          timeout: 30000,
          stdio: 'pipe'
        }, (err, stdout, stderr) => {
          if (err || stderr) {
            reject(new Error(`TypeScript check failed for ${filePath}: ${stderr?.trim() || err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
  } catch (e) {
    // If child_process import fails or execFile throws, skip compile check
    console.warn(`[Compile Check] Skipped for ${filePath}: ${e.message}`);
  }
}

/**
 * Safe write and commit pipeline - the core of Release Guard
 * This function ensures all file modifications go through a consistent safety pipeline:
 *   1. Diff Size Check (reject if > MAX_DIFF_LINES changed)
 *   2. Backup current file
 *   3. Write new content
 *   4. Compile/Syntax check (for JS/TS files)
 *   5. Auto rollback on failure
 * 
 * @param {string} filePath - Path to the file to write
 * @param {string} newContent - New file content
 * @param {number} expectedDiffSize - Expected number of changed lines for validation
 * @returns {Promise<string>} Success message with backup path info
 */
async function safeWriteAndCommit(filePath, newContent, expectedDiffSize) {
["  let oldContent = '';", "  if (fs.existsSync(filePath)) {", "    oldContent = fs.readFileSync(filePath, 'utf8');", "  }"]
  
  // Step 1: Diff Size Check
  const actualDiffLines = calculateDiffLines(oldContent, newContent);
  if (actualDiffLines > MAX_DIFF_LINES) {
    throw new Error(
      `❌ 修改行数超过 ${MAX_DIFF_LINES} 行安全限制，事务中止。请拆分步骤。\n` +
      `实际变更: ${actualDiffLines} 行 | 预期变更: ${expectedDiffSize || '未知'} 行`
    );
  }
  
  // Step 2: Backup before writing
  const backupPath = backupFileBeforePatch(filePath);
  
  // Step 3: Write new content
  fs.writeFileSync(filePath, newContent, 'utf8');
  
  // Step 4: Compile/Syntax check (for JS/TS files)
  try {
    await runCompileCheck(filePath);
  } catch (e) {
    // Step 5: Auto rollback on failure
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
      console.error(`[Auto Rollback] Restored ${filePath} from backup: ${backupPath}`);
    }
    throw new Error(`❌ 语法检查失败，已自动回滚。错误信息: ${e.message}`);
  }
  
  return `✅ 修改成功且通过编译检查。(备份: ${backupPath || '无'})`;
}

/**
 * Handle file_rollback tool - restore file from backup
 * Supports two modes:
 * 1. latest: Automatically find and restore the most recent backup (default)
 * 2. specific: Restore from a specific backup path or backup_id
 */
async function handleFileRollback(args, ws) {
  const filePath = path.resolve(ws || process.cwd(), args.path);
  const backupDirPath = path.join(ws || process.cwd(), BACKUP_DIR);
  
  let targetBackup;
  
  // Check if user specified a specific backup
  if (args.backup_path) {
    targetBackup = path.resolve(ws || process.cwd(), args.backup_path);
    
    if (!fs.existsSync(targetBackup)) {
      return `❌ 备份文件不存在: ${targetBackup}`;
    }
  } else {
    // No specific backup specified, find the latest one for this file
    if (!fs.existsSync(backupDirPath)) {
      return `❌ 未找到备份目录: ${backupDirPath}`;
    }
    
    const fileName = path.basename(filePath);
    // Find all backups for this file and sort by timestamp (newest first)
    const backups = fs.readdirSync(backupDirPath)
      .filter(f => f.startsWith(fileName + '_') && f.endsWith('.bak'))
      .sort((a, b) => b.localeCompare(a));
    
    if (backups.length === 0) {
      return `❌ 未找到文件 ${fileName} 的历史备份`;
    }
    
    targetBackup = path.join(backupDirPath, backups[0]);
  }
  
  // Perform the physical restore
  fs.copyFileSync(targetBackup, filePath);
  
  const backupName = path.basename(targetBackup);
  return `✅ 成功回滚！\n目标文件: ${filePath}\n恢复自备份: ${targetBackup}\n备份名称: ${backupName}`;
}

export const fileTools = [
  {
    name: "file_read",
    description: "读取文件内容，支持行范围和多种读取模式(context/range/full)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" },
        mode: { 
          type: "string", 
          enum: ["context", "range", "full"], 
          description: "读取模式：context=基于行号的上下文窗口, range=指定行范围, full=完整文件内容" 
        }
      },
      required: ["path"]
    }
  },
  {
    name: "file_write",
    description: "写入文件（覆盖或创建）。必须同时提供 path 和 content 两个参数，缺一不可。示例: file_write(path=\"src/foo.py\", content=\"print('hello')\")",
    inputSchema: {
      type: "object",
      properties: {
        path: { 
          type: "string", 
          description: "文件路径（必填），相对于 workspace 根目录或绝对路径" 
        },
        content: { 
          type: "string", 
          description: "文件内容（必填），写入的完整文本" 
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "file_append",
    description: "追加内容到文件末尾。必须提供 path 和 content 两个参数",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（必填）" },
        content: { type: "string", description: "要追加的内容（必填）" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "file_patch",
    description: "精确替换文件中的指定文本。\n支持两种可靠模式：\n1. 操作模式：基于行号的精确操作（推荐），支持 operation: replace_line, insert_line, delete_lines, replace_lines\n2. Context 模式：指定 line + window 参数，在指定行附近读取上下文进行替换（需要 old_str）\n\n注意：已移除不安全的direct/default mode以防止model重构old_str导致的失败",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（必填）" },
        old_str: { type: "string", description: "要被替换的原始文本（context模式时必填）" },
        new_str: { type: "string", description: "替换后的新文本（context模式时必填）" },
        mode: { type: "string", enum: ["context"], description: "替换模式：context=上下文模式（direct模式已移除以提高可靠性）" },
        line: { type: "number", description: "目标行号（operation或context模式时必填）" },
        window: { type: "number", description: "上下文窗口大小（mode=context 时，默认 100 行）" },
        operation: { type: "string", enum: ["replace_line", "insert_line", "delete_lines", "replace_lines"], description: "操作模式：基于行号的精确操作（推荐方式）" },
        content: { type: "string", description: "替换或插入的内容（operation模式时使用）" },
        count: { type: "number", description: "删除或替换的行数（delete_lines/replace_lines操作时使用，默认1）" }
      },
      required: ["path"]
    }
  },
  {
    name: "file_delete_lines",
    description: "删除文件中指定行范围",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number", description: "起始行（1-indexed）" },
        end_line: { type: "number", description: "结束行（1-indexed，含）" }
      },
      required: ["path", "start_line", "end_line"]
    }
  },
  {
    name: "file_rollback",
    description: "回滚文件到上一次修改前的状态。当 file_patch 或代码写坏、报错时，用此工具一键还原文件。\n支持两种模式：\n1. latest（默认）：自动寻找并恢复最新的备份\n2. specific：通过 backup_path 指定特定的备份文件\n\n示例：\n- 回滚到最新备份: {\"path\": \"src/app.js\"}\n- 回滚到指定备份: {\"path\": \"src/app.js\", \"backup_path\": \".lmstudio-backups/app.js_2026-07-07T10-30-00.bak\"}",
    inputSchema: {
      type: "object",
      properties: {
        path: { 
          type: "string", 
          description: "需要回滚的文件路径" 
        },
        backup_path: { 
          type: "string", 
          description: "指定的备份文件路径（可选，不填则自动寻找最新的备份）" 
        }
      },
      required: ["path"]
    }
  },
  // New Edit Transaction Tools
  {
    name: "edit_begin",
    description: "开始一个编辑事务。读取文件指定范围的内容到内存 buffer 中。\n返回 buffer_id，后续使用 edit_apply、edit_review、edit_commit 操作该 buffer。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要编辑的文件路径" },
        start_line: { type: "number", description: "起始行号（1-indexed）" },
        end_line: { type: "number", description: "结束行号（1-indexed，含）" }
      },
      required: ["path"]
    }
  },
  {
    name: "edit_apply",
    description: "对 edit_begin 创建的 buffer 应用修改。\n支持两种方式：\n1. replacements 数组：按行号替换内容",
    inputSchema: {
      type: "object",
      properties: {
        buffer_id: { type: "string", description: "edit_begin 返回的 buffer ID" },
        replacements: { 
          type: "array", 
          items: { 
            type: "object",
            properties: {
              line: { type: "number", description: "行号（1-indexed）" },
              new_content: { type: "string", description: "新内容" }
            },
            required: ["line", "new_content"]
          }
        },
      },
      required: ["buffer_id"]
    }
  },
  {
    name: "edit_review",
    description: "审查 edit_begin 创建的 buffer。检查括号匹配、缩进、语法等。\n返回审查结果和建议。",
    inputSchema: {
      type: "object",
      properties: {
        buffer_id: { type: "string", description: "要审查的 buffer ID" },
        language: { 
          type: "string", 
          enum: ["javascript", "typescript", "python", "go", "rust"],
          description: "代码语言（用于语法检查）" 
        }
      },
      required: ["buffer_id"]
    }
  },
  {
    name: "edit_commit",
    description: "提交 edit_begin 创建的 buffer。将修改写入文件，并创建备份。\n提交后 buffer 将被清除。",
    inputSchema: {
      type: "object",
      properties: {
        buffer_id: { type: "string", description: "要提交的 buffer ID" }
      },
      required: ["buffer_id"]
    }
  },
  {
    name: "edit_cancel",
    description: "取消 edit_begin 创建的编辑会话。丢弃所有未提交的修改。",
    inputSchema: {
      type: "object",
      properties: {
        buffer_id: { type: "string", description: "要取消的 buffer ID" }
      },
      required: ["buffer_id"]
    }
  }
];

// Helper functions for edit review
function checkBrackets(content) {
  const stack = [];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const openers = Object.keys(pairs);
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (openers.includes(char)) {
      stack.push({ char, index: i });
    } else if (Object.values(pairs).includes(char)) {
      const lastOpener = stack.pop();
      if (!lastOpener || pairs[lastOpener.char] !== char) {
        return { valid: false, error: `不匹配的括号在位置 ${i}` };
      }
    }
  }
  
  if (stack.length > 0) {
    return { valid: false, error: `未闭合的括号: ${stack.map(s => s.char).join(', ')}` };
  }
  
  return { valid: true };
}

function checkIndentation(lines) {
  let errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Check for mixed tabs/spaces
    const leadingWhitespace = line.match(/^[\t ]*/)[0];
    if (leadingWhitespace.includes('\t') && leadingWhitespace.includes(' ')) {
      errors.push(`第 ${i + 1} 行：混合使用制表符和空格`);
    }
    
    // Check for excessive indentation
    const indentLevel = Math.floor(leadingWhitespace.length / 2);
    if (indentLevel > 20) {
      errors.push(`第 ${i + 1} 行：缩进过深 (${indentLevel} 层)`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

function generateDiff(filePath, newContent, startLine, endLine) {
  // Simple diff generation
  const oldContent = fs.readFileSync(filePath, 'utf8');
  const oldLines = oldContent.split('\n').slice(startLine - 1, endLine);
  const newLines = newContent.split('\n');
  
  let changes = [];
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      changes.push({
        line: startLine + i,
        old: oldLines[i],
        new: newLines[i]
      });
    }
  }
  
  return { changed: changes.length > 0, changes };
}

async function checkSyntax(language, content) {
  // Placeholder for syntax checking
  // In a real implementation, this would use a parser
  return { valid: true, language };
}

function checkRemovedContent(originalLines, newLines) {
  const removed = originalLines - newLines;
  if (removed > 0) {
    return { removed, warning: `删除了 ${removed} 行内容` };
  }
  return { removed: 0, warning: null };
}

// File version tracking for conflict detection
const fileVersions = new Map();

function updateFileVersion(filePath) {
  try {
    const stats = fs.statSync(filePath);
    fileVersions.set(filePath, {
      mtime: stats.mtimeMs,
      size: stats.size
    });
  } catch (e) {
    // File may have been deleted
    fileVersions.delete(filePath);
  }
}

function getFileVersion(filePath) {
  return fileVersions.get(filePath);
}

export async function handleFileTools(name, args, context) {
  // Use middleware for security and context
  return await ToolMiddleware.executeWithMiddleware(
    async (toolName, toolArgs, context) => {
      const ws = context.workspace;
      
      switch (toolName) {
        case "file_read": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          let content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          const totalLines = lines.length;

          // Handle different modes
          let startLine = 1;
          let endLine = totalLines;
          
          if (args.mode === "context" && args.line !== undefined) {
            // Context mode: read around a specific line with window size
            const targetLineIndex = Math.max(0, Math.min(totalLines - 1, args.line - 1));
            const windowSize = args.window || 100; // Default window of 100 lines
            const halfWindow = Math.floor(windowSize / 2);
            
            startLine = Math.max(1, targetLineIndex - halfWindow + 1);
            endLine = Math.min(totalLines, startLine + windowSize - 1);
            
            // Adjust if we're near the beginning or end
            if (startLine === 1) {
              endLine = Math.min(totalLines, windowSize);
            } else if (endLine === totalLines) {
              startLine = Math.max(1, totalLines - windowSize + 1);
            }
          } else if (args.mode === "range" || (args.start_line !== undefined && args.end_line !== undefined)) {
            // Range mode: read specific line range (backward compatible)
            startLine = Math.max(1, args.start_line || 1);
            endLine = Math.min(totalLines, args.end_line || totalLines);
          } else if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
            // Full mode: read entire file (default when no range specified)
            startLine = 1;
            endLine = totalLines;
          }
          
          // Extract the actual content for this range
          const rangeContent = lines.slice(startLine - 1, endLine).join('\n');
          
          // For full mode, return plain text (most common use case)
          // For context/range modes, return EditBuffer for potential editing
          if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
            return rangeContent;
          }
          
          // Return EditBuffer object for context/range modes
          return {
            bufferId: `buf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            path: filePath,
            startLine,
            endLine,
            totalLines,
            content: rangeContent
          };
        }
        
["        case \"file_write\": {", "          const filePath = path.resolve(ws || process.cwd(), args.path);", "          // Ensure directory exists", "          const dir = path.dirname(filePath);", "          if (!fs.existsSync(dir)) {", "            fs.mkdirSync(dir, { recursive: true });", "          }", "          const expectedDiffSize = args.content.split('\\n').length;", "          try {", "            await safeWriteAndCommit(filePath, args.content, expectedDiffSize);", "            return `✅ 已写入文件: ${filePath}`;", "          } catch (e) {", "            return e.message;", "          }", "        }"]
        
["        case \"file_append\": {", "          const filePath = path.resolve(ws || process.cwd(), args.path);", "          // Ensure directory exists", "          const dir = path.dirname(filePath);", "          if (!fs.existsSync(dir)) {", "            fs.mkdirSync(dir, { recursive: true });", "          }", "          let content = '';", "          if (fs.existsSync(filePath)) {", "            content = fs.readFileSync(filePath, 'utf8');", "          }", "          const newContent = content + args.content + '\\n';", "          const expectedDiffSize = args.content.split('\\n').length;", "          try {", "            await safeWriteAndCommit(filePath, newContent, expectedDiffSize);", "            return `✅ 已追加内容到文件: ${filePath}`;", "          } catch (e) {", "            return e.message;", "          }", "        }"]
        
        case "file_patch": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          // Trigger backup before patching
          const backupPath = backupFileBeforePatch(filePath);
          
          let content = fs.readFileSync(filePath, 'utf8');
          
          // 新增：基于行号的操作（推荐方式，避免 old_str 不可靠问题）
          if (args.operation) {
            const lines = content.split('\n');
            switch (args.operation) {
              case "replace_line": {
                if (!args.line) throw new Error(`替换行需要指定 line 参数`);
                const lineIndex = Math.max(args.line, 1) - 1;
                if (lineIndex >= lines.length) {
                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;
                }
                
                const oldContent = lines[lineIndex];
                lines[lineIndex] = args.content || "";
                
                const newContent = lines.join("\n");
                try {
                  await safeWriteAndCommit(filePath, newContent, 1);
                } catch (e) { return e.message; }
                return `✅ 已替换第 ${args.line} 行: ${filePath}\n` +
                       `旧内容: "${oldContent.slice(0, 50)}"${oldContent.length > 50 ? "..." : ""}\n` +
                       `新内容: "${lines[lineIndex].slice(0, 50)}"${lines[lineIndex].length > 50 ? "..." : ""}`;
              }
              
              case "insert_line": {
                if (!args.line) throw new Error(`插入行需要指定 line 参数`);
                const lineIndex = Math.max(args.line, 1) - 1;
                if (lineIndex > lines.length) {
                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;
                }
                
                lines.splice(lineIndex, 0, args.content || "");
                const newContent = lines.join('\n');
                try {
                  await safeWriteAndCommit(filePath, newContent, 1);
                } catch (e) { return e.message; }
                return `✅ 已在第 ${args.line} 行插入内容: ${filePath}\n` +
                       `插入内容: "${(args.content || "").slice(0, 50)}"${(args.content || "").length > 50 ? "..." : ""}`;
              }
              
              case "delete_lines": {
                if (!args.line) throw new Error(`删除行需要指定 line 参数`);
                const startLine = Math.max(args.line, 1) - 1;
                const deleteCount = args.count || 1;
                
                if (startLine >= lines.length) {
                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;
                }
                
                const deletedContent = lines.splice(startLine, deleteCount);
                const newContent = lines.join('\n');
                try {
                  await safeWriteAndCommit(filePath, newContent, deleteCount + 1);
                } catch (e) { return e.message; }
                return `✅ 已删除第 ${args.line}-${args.line + deleteCount - 1} 行（共 ${deleteCount} 行）: ${filePath}\n` +
                       `删除内容: ${deletedContent.map((c, i) => `  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"`).join('\n')}`;
              }
              
              case "replace_lines": {
                if (!args.line) throw new Error(`替换行范围需要指定 line 参数`);
                const startLine = Math.max(args.line, 1) - 1;
                const replaceCount = args.count || 1;
                
                if (startLine >= lines.length) {
                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;
                }
                
                const deletedContent = lines.splice(startLine, replaceCount, ...(Array.isArray(args.content) ? args.content : [args.content || ""]));
                const newContent = lines.join('\n');
                try {
                  await safeWriteAndCommit(filePath, newContent, replaceCount + 1);
                } catch (e) { return e.message; }
                return `✅ 已替换第 ${args.line}-${args.line + replaceCount - 1} 行（共 ${replaceCount} 行）: ${filePath}\n` +
                       `删除内容: ${deletedContent.map((c, i) => `  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"`).join('\n')}\n` +
                       `新内容: ${Array.isArray(args.content) ? args.content.map((c, i) => `  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"`).join('\n') : `  第${args.line}行: "${(args.content || "").slice(0, 40)}"${(args.content || "").length > 40 ? "..." : ""}`}`;
              }
              
              default:
                throw new Error(`不支持的 operation: ${args.operation}. 支持的操作: replace_line, insert_line, delete_lines, replace_lines`);
            }
          } else {
            // Context 模式：读取指定行附近的上下文进行替换（已移除问题-prone 的 direct/default mode）
            if (!args.line) throw new Error(`Context 模式需要指定 line 参数`);
            
            const mode = args.mode || "context"; // 默认现在是 context 而不是 direct
            
            if (mode === "context") {
              // Context 模式：读取指定行附近的上下文进行替换
              const window = args.window || 100;
              const targetLine = Math.max(args.line || 1, 1);
              const half = Math.floor(window / 2);
              
              // 计算读取范围
              let start = Math.max(targetLine - half - 1, 0);
              let end = Math.min(start + window, lines.length);
              
              // 读取上下文
              const contextLines = lines.slice(start, end);
              const contextContent = contextLines.join('\n');
              
              // 在上下文中搜索
              if (!contextContent.includes(args.old_str)) {
                return `❌ Context 模式未找到匹配文本: "${args.old_str.slice(0, 50)}..."\n` +
                       `目标行: ${targetLine}\n上下文范围: L${start + 1}-L${end} (${window}行)`;
              }
              
              // 替换
              const patchedContext = contextContent.replace(args.old_str, args.new_str);
              
              // 构建新文件：before + patched + after
              const before = lines.slice(0, start).join('\n');
              const after = lines.slice(end).join('\n');
              const finalContent = before + (before && !before.endsWith('\n') ? '\n' : '') + 
                              patchedContext + (after && !after.startsWith('\n') ? '\n' : '') + after;
              
              // Calculate expected diff size for context mode
              const oldContextLines = contextLines.join('\n');
              const expectedDiff = calculateDiffLines(oldContextLines, patchedContext);

              try {
                await safeWriteAndCommit(filePath, finalContent, expectedDiff);
              } catch (e) { return e.message; }
              
              return `✅ Context 模式替换完成: ${filePath}\n` +
                     `目标行: ${targetLine}\n` +
                     `上下文窗口: ${window} 行\n`;
            } else {
              // 移除不安全的 direct mode，强制使用 context 或 operation 模式
              throw new Error(`不支持的 mode: ${args.mode}. 为了可靠性，已移除 direct/default mode。请使用 operation (replace_line/insert_line/delete_lines/replace_lines) 或 context 模式`);
            }
          }
        }
        
["        case \"file_delete_lines\": {", "          const filePath = path.resolve(ws || process.cwd(), args.path);", "          if (!fs.existsSync(filePath)) {", "            throw new Error(`文件不存在: ${filePath}`);", "          }", "", "          let content = fs.readFileSync(filePath, 'utf8');", "          const lines = content.split('\\n');", "", "          const startLine = Math.max(args.start_line || 1, 1);", "          const endLine = Math.min(lines.length, args.end_line || lines.length);", "", "          if (startLine > endLine) {", "            return `❌ 行范围无效: ${startLine}-${endLine}`;", "          }", "", "          const newLines = [", "            ...lines.slice(0, startLine - 1),", "            ...lines.slice(endLine)", "          ];", "          const newContent = newLines.join('\\n');", "          const expectedDiffSize = endLine - startLine + 1; // 预期的变更行数", "", "          try {", "            await safeWriteAndCommit(filePath, newContent, expectedDiffSize);", "            return `✅ 已删除文件行 ${startLine}-${endLine}: ${filePath}`;", "          } catch (e) {", "            return e.message;", "          }", "        }"]
        
        
        case "file_rollback": {
          return await handleFileRollback(args, ws);
        }
        
        // New Edit Transaction Tools
        case "edit_begin": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          let content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          
          // Determine range
          let startLine = 1;
          let endLine = lines.length;
          
          if (args.start_line) {
            startLine = Math.max(1, args.start_line);
          }
          if (args.end_line) {
            endLine = Math.min(lines.length, args.end_line);
          }
          
          // Extract range content
          const rangeContent = lines.slice(startLine - 1, endLine).join('\n');
          
          // Create buffer and store in pool
          const bufferId = `edit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          bufferPool.set(bufferId, {
            path: filePath,
            content: rangeContent,
            startLine,
            endLine,
            originalLines: lines.length
          });
          
          return {
            bufferId,
            path: filePath,
            startLine,
            endLine,
            totalLines: lines.length,
            message: `✅ 编辑会话已开始，buffer ID: ${bufferId}`
          };
        }
        
        case "edit_apply": {
          const bufferId = args.buffer_id;
          if (!bufferPool.has(bufferId)) {
            return { error: `Buffer 不存在: ${bufferId}` };
          }
          
          const buffer = bufferPool.get(bufferId);
          let lines = buffer.content.split('\n');
          
          // Apply line replacements
          for (const replacement of args.replacements || []) {
            const lineIndex = Math.max(replacement.line, 1) - 1;
            if (lineIndex >= lines.length) continue;
            
            if (replacement.new_content !== undefined) {
              lines[lineIndex] = replacement.new_content;
            }
          }
          
          // Update buffer
          buffer.content = lines.join('\n');
          bufferPool.set(bufferId, buffer);
          
          return {
            bufferId,
            path: buffer.path,
            startLine: buffer.startLine,
            endLine: buffer.endLine,
            modified: true,
            message: `✅ 修改已应用到 buffer: ${bufferId}`
          };
        }
        
        case "edit_review": {
          const bufferId = args.buffer_id;
          if (!bufferPool.has(bufferId)) {
            return { error: `Buffer 不存在: ${bufferId}` };
          }
          
          const buffer = bufferPool.get(bufferId);
          const lines = buffer.content.split('\n');
          
          // Perform checks
          const checks = {
            brackets: checkBrackets(buffer.content),
            indentation: checkIndentation(lines),
            diff: generateDiff(buffer.path, buffer.content, buffer.startLine, buffer.endLine),
            syntax: args.language ? await checkSyntax(args.language, buffer.content) : null,
            removedContent: checkRemovedContent(buffer.originalLines, lines.length)
          };
          
          return {
            bufferId,
            path: buffer.path,
            checks,
            summary: `✅ 审查完成。括号: ${checks.brackets.valid ? '✓' : '✗'}，缩进: ${checks.indentation.valid ? '✓' : '✗'}`
          };
        }
        
        case "edit_commit": {
          const bufferId = args.buffer_id;
          if (!bufferPool.has(bufferId)) {
            return `❌ Buffer 不存在: ${bufferId}`;
          }
          
          const buffer = bufferPool.get(bufferId);
          
          // Read current file content
          const filePath = path.resolve(ws || process.cwd(), buffer.path);
          let currentContent = fs.readFileSync(filePath, 'utf8');
          const currentLines = currentContent.split('\n');
          
          // Replace the range with buffer content
          const newLines = [
            ...currentLines.slice(0, buffer.startLine - 1),
            ...buffer.content.split('\n'),
            ...currentLines.slice(buffer.endLine)
          ];
          
          // Backup before commit (new strategy: only backup at commit time)
          const backupPath = backupFileBeforePatch(filePath);
          
          // Scope Check: ensure modification is within buffer range
          const bufferContentLines = buffer.content.split('\n');
          const originalRangeLines = currentLines.slice(buffer.startLine - 1, buffer.endLine);
          
          // Calculate expected diff size for the committed content
          let expectedDiff = 0;
          for (let j = 0; j < Math.max(originalRangeLines.length, bufferContentLines.length); j++) {
            if (originalRangeLines[j] !== bufferContentLines[j]) {
              expectedDiff++;
            }
          }

          // Write using safe pipeline
          try {
            await safeWriteAndCommit(filePath, newLines.join('\n'), expectedDiff);
          } catch (e) { return e.message; }
          
          // Update file version tracking for conflict detection
          updateFileVersion(filePath);
          
          // Clear buffer
          bufferPool.delete(bufferId);
          
          return {
            path: filePath,
            backupPath,
            message: `✅ 编辑已提交！备份路径: ${backupPath || '无'}`
          };
        }
        
        case "edit_cancel": {
          const bufferId = args.buffer_id;
          if (bufferPool.has(bufferId)) {
            bufferPool.delete(bufferId);
            return `✅ 编辑会话已取消: ${bufferId}`;
          }
          return `⚠️ Buffer 不存在: ${bufferId}`;
        }
        
        default:
          throw new Error(`未知文件工具: ${name}`);
      }
    },
    name,
    args,
    { conversation_id: context }
  );
}

// Buffer lifecycle management
const BUFFER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cleanupExpiredBuffers() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [bufferId, buffer] of bufferPool.entries()) {
    if (now - buffer.createdAt > BUFFER_TTL_MS) {
      console.log(`🧹 Auto-cleanup expired buffer: ${bufferId}`);
      bufferPool.delete(bufferId);
      cleaned++;
    }
  }
  
  return cleaned;
}

// Run cleanup periodically
setInterval(cleanupExpiredBuffers, 60 * 60 * 1000); // Every hour

// Export for testing
export { cleanupExpiredBuffers };
