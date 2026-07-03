// src/tools/file.js
import { workspaceManager } from '../managers/workspace.js';
import { ToolMiddleware } from '../utils/middleware.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const fileTools = [
  {
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
  {\n    name: "file_patch",\n    description: "精确替换文件中的指定文本。\n支持两种可靠模式：\n1. 操作模式：基于行号的精确操作（推荐），支持 operation: replace_line, insert_line, delete_lines, replace_lines\n2. Context 模式：指定 line + window 参数，在指定行附近读取上下文进行替换（需要 old_str）\n\n注意：已移除不安全的direct/default mode以防止model重构old_str导致的失败",\n    inputSchema: {\n      type: "object",\n      properties: {\n        path: { type: "string", description: "文件路径（必填）" },\n        old_str: { type: "string", description: "要被替换的原始文本（context模式时必填）" },\n        new_str: { type: "string", description: "替换后的新文本（context模式时必填）" },\n        mode: { type: "string", enum: ["context"], description: "替换模式：context=上下文模式（direct模式已移除以提高可靠性）" },\n        line: { type: "number", description: "目标行号（operation或context模式时必填）" },\n        window: { type: "number", description: "上下文窗口大小（mode=context 时，默认 100 行）" },\n        operation: { type: "string", enum: ["replace_line", "insert_line", "delete_lines", "replace_lines"], description: "操作模式：基于行号的精确操作（推荐方式）" },\n        content: { type: "string", description: "替换或插入的内容（operation模式时使用）" },\n        count: { type: "number", description: "删除或替换的行数（delete_lines/replace_lines操作时使用，默认1）" }\n      },\n      required: ["path"]\n    }\n  },
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
            const lines = content.split('\\n');
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
            
            content = lines.slice(startIndex, endIndex).join('\\n');
          } else if (args.mode === "range" || (args.start_line !== undefined && args.end_line !== undefined)) {
            // Range mode: read specific line range (backward compatible)
            const lines = content.split('\\n');
            const startLine = Math.max(1, args.start_line || 1);
            const endLine = Math.min(lines.length, args.end_line || lines.length);
            content = lines.slice(startLine - 1, endLine).join('\\n');
          } else if (args.mode === "full" || (args.start_line === undefined && args.end_line === undefined)) {
            // Full mode: read entire file (default when no range specified)
            // Content already loaded above
          }
          
          return content;
        }
          
          return content;
        }
        
        case "file_write": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          // Ensure directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, args.content, 'utf8');
          return `✅ 已写入文件: ${filePath}`;
        }
        
        case "file_append": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          // Ensure directory exists
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.appendFileSync(filePath, args.content + '\n', 'utf8');
          return `✅ 已追加内容到文件: ${filePath}`;
        }
        
        case "file_patch": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          let content = fs.readFileSync(filePath, 'utf8');
          
          if (args.mode === "context" && args.line !== undefined) {
            // Context mode: read around the line and replace within that context
            const lines = content.split('\n');
            const targetLineIndex = Math.max(0, Math.min(lines.length - 1, args.line - 1));
            const startIndex = Math.max(0, targetLineIndex - Math.floor(args.window / 2));
            const endIndex = Math.min(lines.length, startIndex + args.window);
            
            const contextLines = lines.slice(startIndex, endIndex);
            const contextContent = contextLines.join('\n');
            
            let replacedContext;
        case "file_patch": {\n          const filePath = path.resolve(ws || process.cwd(), args.path);\n          if (!fs.existsSync(filePath)) {\n            throw new Error(`文件不存在: ${filePath}`);\n          }\n          \n          let content = fs.readFileSync(filePath, "utf8");\n          \n          // 新增：基于行号的操作（推荐方式，避免 old_str 不可靠问题）\n          if (args.operation) {\n            const lines = content.split("\n");\n            switch (args.operation) {\n              case "replace_line": {\n                if (!args.line) throw new Error(`替换行需要指定 line 参数`);\n                const lineIndex = Math.max(args.line, 1) - 1;\n                if (lineIndex >= lines.length) {\n                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;\n                }\n                \n                const oldContent = lines[lineIndex];\n                lines[lineIndex] = args.content || "";\n                \n                fs.writeFileSync(filePath, lines.join("\n"), "utf8");\n                return `✅ 已替换第 ${args.line} 行: ${filePath}\\n` +\n                       `旧内容: "${oldContent.slice(0, 50)}"${oldContent.length > 50 ? "..." : ""}\\n` +\n                       `新内容: "${lines[lineIndex].slice(0, 50)}"${lines[lineIndex].length > 50 ? "..." : ""}`;\n              }\n                \n              case "insert_line": {\n                if (!args.line) throw new Error(`插入行需要指定 line 参数`);\n                const lineIndex = Math.max(args.line, 1) - 1;\n                if (lineIndex > lines.length) {\n                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;\n                }\n                \n                lines.splice(lineIndex, 0, args.content || "");\n                fs.writeFileSync(filePath, lines.join("\n"), "utf8");\n                return `✅ 已在第 ${args.line} 行插入内容: ${filePath}\\n` +\n                       `插入内容: "${(args.content || "").slice(0, 50)}"${(args.content || "").length > 50 ? "..." : ""}`;\n              }\n                \n              case "delete_lines": {\n                if (!args.line) throw new Error(`删除行需要指定 line 参数`);\n                const startLine = Math.max(args.line, 1) - 1;\n                const deleteCount = args.count || 1;\n                \n                if (startLine >= lines.length) {\n                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;\n                }\n                \n                const deletedContent = lines.splice(startLine, deleteCount);\n                fs.writeFileSync(filePath, lines.join("\n"), "utf8");\n                return `✅ 已删除第 ${args.line}-${args.line + deleteCount - 1} 行（共 ${deleteCount} 行）: ${filePath}\\n` +\n                       `删除内容: ${deletedContent.map((c, i) => \"  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"}).join("\n")`;\n              }\n                \n              case "replace_lines": {\n                if (!args.line) throw new Error(`替换行范围需要指定 line 参数`);\n                const startLine = Math.max(args.line, 1) - 1;\n                const replaceCount = args.count || 1;\n                \n                if (startLine >= lines.length) {\n                  return `❌ 行号超出范围: ${args.line}，文件只有 ${lines.length} 行`;\n                }\n                \n                const deletedContent = lines.splice(startLine, replaceCount, ...(Array.isArray(args.content) ? args.content : [args.content || ""]));\n                fs.writeFileSync(filePath, lines.join("\n"), "utf8");\n                return `✅ 已替换第 ${args.line}-${args.line + replaceCount - 1} 行（共 ${replaceCount} 行）: ${filePath}\\n` +\n                       `删除内容: ${deletedContent.map((c, i) => \"  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"}).join("\n")\\n` +\n                       `新内容: ${Array.isArray(args.content) ? args.content.map((c, i) => \"  第${args.line + i}行: "${c.slice(0, 40)}"${c.length > 40 ? "..." : ""}"}).join("\n") : \"  第${args.line}行: "${(args.content || "").slice(0, 40)}"${(args.content || "").length > 40 ? "..." : ""}`};\n              }\n                \n              default:\n                throw new Error(`不支持的 operation: ${args.operation}. 支持的操作: replace_line, insert_line, delete_lines, replace_lines`);\n            }\n          } else {\n            // Context 模式：读取指定行附近的上下文进行替换（已移除问题-prone 的 direct/default mode）\n            if (!args.line) throw new Error(`Context 模式需要指定 line 参数`);\n            \n            const mode = args.mode || "context"; // 默认现在是 context 而不是 direct\n            \n            if (mode === "context") {\n              // Context 模式：读取指定行附近的上下文进行替换\n              const window = args.window || 100;\n              const targetLine = Math.max(args.line || 1, 1);\n              const half = Math.floor(window / 2);\n              \n              // 计算读取范围\n              let start = Math.max(targetLine - half - 1, 0);\n              let end = Math.min(start + window, lines.length);\n              \n              // 读取上下文\n              const contextLines = lines.slice(start, end);\n              const contextContent = contextLines.join("\n");\n              \n              // 在上下文中搜索\n              if (!contextContent.includes(args.old_str)) {\n                return `❌ Context 模式未找到匹配文本: "${args.old_str.slice(0, 50)}..."\\n` +\n                       `目标行: ${targetLine}\\n上下文范围: L${start + 1}-L${end} (${window}行)`;\n              }\n              \n              // 替换\n              const patchedContext = contextContent.replace(args.old_str, args.new_str);\n              \n              // 构建新文件：before + patched + after\n              const before = lines.slice(0, start).join("\n");\n              const after = lines.slice(end).join("\n");\n              const finalContent = before + (before && !before.endsWith("\n") ? "\n" : "") + \n                              patchedContext + (after && !after.startsWith("\n") ? "\n" : "") + after;\n              \n              fs.writeFileSync(filePath, finalContent, "utf8");\n              \n              return `✅ Context 模式替换完成: ${filePath}\\n` +\n                     `目标行: ${targetLine}\\n` +\n                     `上下文窗口: ${window} 行\\n`;\n            } else {\n              // 移除不安全的 direct mode，强制使用 context 或 operation 模式\n              throw new Error(`不支持的 mode: ${args.mode}. 为了可靠性，已移除 direct/default mode。请使用 operation (replace_line/insert_line/delete_lines/replace_lines) 或 context 模式`);\n            }\n          }\n        },
            ...lines.slice(0, startLine - 1),
            ...lines.slice(endLine)
          ];
          
          fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
          return `✅ 已删除文件行 ${startLine}-${endLine}: ${filePath}`;
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