// src/tools/file_patch.js - Slimmed tool following new contract
// Only does business logic, trusts ctx.workspace

import fs from 'fs';
import path from 'path';
import { calculateDiffLines, safeWriteAndCommit } from './file.js';

/**
 * file_patch tool - Slim version
 * 
 * Contract:
 * - Input: (ctx, args) where ctx.workspace is Single Source of Truth
 * - Output: Success message
 * - No backup, no path resolution - all done in Stage
 */
export async function file_patch(ctx, args) {
  // Trust ctx.workspace (set by WorkspaceStage)
  const ws = ctx.workspace;
  if (!ws) {
    throw new Error('[file_patch] Workspace not set in context');
  }

  const filePath = path.resolve(ws, args.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Based on line number operation (recommended)
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
        throw new Error(`不支持的 operation: ${args.operation}`);
    }
  } else {
    // Context mode
    if (!args.line) throw new Error(`Context 模式需要指定 line 参数`);
    
    const mode = args.mode || "context";
    
    if (mode === "context") {
      const window = args.window || 100;
      const targetLine = Math.max(args.line || 1, 1);
      const lines = content.split('\n');
      const half = Math.floor(window / 2);
      
      let start = Math.max(targetLine - half - 1, 0);
      let end = Math.min(start + window, lines.length);
      
      const contextLines = lines.slice(start, end);
      const contextContent = contextLines.join('\n');
      
      if (!contextContent.includes(args.old_str)) {
        return `❌ Context 模式未找到匹配文本: "${args.old_str.slice(0, 50)}..."\n` +
               `目标行: ${targetLine}\n上下文范围: L${start + 1}-L${end} (${window}行)`;
      }
      
      const patchedContext = contextContent.replace(args.old_str, args.new_str);
      const before = lines.slice(0, start).join('\n');
      const after = lines.slice(end).join('\n');
      const finalContent = before + (before && !before.endsWith('\n') ? '\n' : '') + 
                      patchedContext + (after && !after.startsWith('\n') ? '\n' : '') + after;
      
      const oldContextLines = contextLines.join('\n');
      const expectedDiff = calculateDiffLines(oldContextLines, patchedContext);

      try {
        await safeWriteAndCommit(filePath, finalContent, expectedDiff);
      } catch (e) { return e.message; }
      
      return `✅ Context 模式替换完成: ${filePath}\n` +
             `目标行: ${targetLine}\n` +
             `上下文窗口: ${window} 行\n`;
    } else {
      throw new Error(`不支持的 mode: ${args.mode}`);
    }
  }
}
