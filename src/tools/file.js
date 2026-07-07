// src/tools/file.js
import { workspaceManager } from '../managers/workspace.js';
import { ToolMiddleware } from '../utils/middleware.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Backup directory constant
const BACKUP_DIR = '.lmstudio-backups';

/**
 * Create a backup of a file before modification
 * @param {string} filePath - Path to the file to backup
 * @returns {string|null} - Path to the backup file, or null if no backup needed
 */
function backupFileBeforePatch(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null; // No backup needed for new files
    
    const ws = workspaceManager.getWorkspaceForSession('default') || process.cwd();
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

/**
 * Handle file_rollback tool - restore file from backup
 */
async function handleFileRollback(args, ws) {
  const filePath = path.resolve(ws || process.cwd(), args.path);
  const backupDirPath = path.join(ws || process.cwd(), BACKUP_DIR);
  
  let targetBackup = args.backup_path;
  
  // If no specific backup specified, find the latest one for this file
  if (!targetBackup) {
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
  } else {
    targetBackup = path.resolve(ws || process.cwd(), targetBackup);
  }
  
  if (!fs.existsSync(targetBackup)) {
    return `❌ 备份文件不存在: ${targetBackup}`;
  }
  
  // Perform the physical restore
  fs.copyFileSync(targetBackup, filePath);
  
  return `✅ 成功回滚！\n目标文件: ${filePath}\n恢复自备份: ${targetBackup}`;
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
    description: "回滚文件到上一次修改前的状态。当 file_patch 或代码写坏、报错时，用此工具一键还原文件。",
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
  }
];

export async function handleFileTools(name, args, convId) {
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
          
          // Handle different modes
          if (args.mode === "context" && args.line !== undefined) {
            // Context mode: read around a specific line with window size
            const lines = content.split('\n');
            const targetLineIndex = Math.max(0, Math.min(lines.length - 1, args.line - 1));
            const windowSize = args.window || 100; // Default window of 100 lines
            const halfWindow = Math.floor(windowSize / 2);
            
            let startIndex = Math.max(0, targetLineIndex - halfWindow);
            let endIndex = Math.min(lines.length, startIndex + windowSize);
            
            // Adjust if we're near the beginning or end
            if (startIndex === 0) {
              endIndex = Math.min(lines.length, windowSize);
            } else if (endIndex === lines.length) {
              startIndex = Math.max(0, lines.length - windowSize);
            }
            
            content = lines.slice(startIndex, endIndex).join('\n');
          } else if (args.mode === "range" || (args.start_line !== undefined && args.end_line !== undefined)) {
            // Range mode: read specific line range (backward compatible)
            const lines = content.split('\n');
            const startLine = Math.max(1, args.start_line || 1);
            const endLine = Math.min(lines.length, args.end_line || lines.length);
            content = lines.slice(startLine - 1, endLine).join('\n');
          } else if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
            // Full mode: read entire file (default when no range specified)
            // Content already loaded above
          }
          
          return content;
        }
        
        case "file_write": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          // Trigger backup before writing
          const backupPath = backupFileBeforePatch(filePath);
          
          // Ensure directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, args.content, 'utf8');
          return `✅ 已写入文件: ${filePath}\n(已备份至: ${backupPath || '无'})`;
        }
        
        case "file_append": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          // Trigger backup before appending
          const backupPath = backupFileBeforePatch(filePath);
          
          // Ensure directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.appendFileSync(filePath, args.content + '\n', 'utf8');
          return `✅ 已追加内容到文件: ${filePath}\n(已备份至: ${backupPath || '无'})`;
        }
        
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
                
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
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
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
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
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
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
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
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
              
              fs.writeFileSync(filePath, finalContent, 'utf8');
              
              return `✅ Context 模式替换完成: ${filePath}\n` +
                     `目标行: ${targetLine}\n` +
                     `上下文窗口: ${window} 行\n`;
            } else {
              // 移除不安全的 direct mode，强制使用 context 或 operation 模式
              throw new Error(`不支持的 mode: ${args.mode}. 为了可靠性，已移除 direct/default mode。请使用 operation (replace_line/insert_line/delete_lines/replace_lines) 或 context 模式`);
            }
          }
        }
        
        case "file_delete_lines": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          // Trigger backup before deleting
          const backupPath = backupFileBeforePatch(filePath);
          
          let content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          
          const startLine = Math.max(args.start_line || 1, 1);
          const endLine = Math.min(lines.length, args.end_line || lines.length);
          
          if (startLine > endLine) {
            return `❌ 行范围无效: ${startLine}-${endLine}`;
          }
          
          const newLines = [
            ...lines.slice(0, startLine - 1),
            ...lines.slice(endLine)
          ];
          
          fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
          return `✅ 已删除文件行 ${startLine}-${endLine}: ${filePath}\n(已备份至: ${backupPath || '无'})`;
        }
        
        case "file_rollback": {
          return await handleFileRollback(args, ws);
        }
        
        default:
          throw new Error(`未知文件工具: ${name}`);
      }
    },
    name,
    args,
    { conversation_id: convId }
  );
}