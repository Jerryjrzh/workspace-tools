// src/tools/file.js
import { workspaceManager } from '../managers/workspace.js';
import { ToolMiddleware } from '../utils/middleware.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const fileTools = [
  {
    name: "file_read",
    description: "读取文件内容，支持行范围",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" }
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
    description: "精确替换文件中的指定文本（oldStr → newStr），不需要重写整个文件。支持两种模式：1. 默认模式：直接全文搜索替换（快速，但可能匹配多个位置） 2. Context 模式：指定 line + window 参数，在指定行附近读取上下文进行替换，避免误匹配",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（必填）" },
        old_str: { type: "string", description: "要被替换的原始文本（必填，需精确匹配）" },
        new_str: { type: "string", description: "替换后的新文本（必填）" },
        mode: { 
          type: "string", 
          enum: ["direct", "context"], 
          description: "替换模式：direct=全文搜索（默认）| context=上下文模式",
          default: "direct"
        },
        line: { type: "number", description: "目标行号（mode=context 时必填）" },
        window: { type: "number", description: "上下文窗口大小（mode=context 时，默认 100 行），默认 100" },
        all: { type: "boolean", description: "是否替换所有匹配，默认只替换第一个（mode=direct 时有效）", default: false }
      },
      required: ["path", "old_str", "new_str"]
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
          
          if (args.start_line !== undefined && args.end_line !== undefined) {
            const lines = content.split('\n');
            const startLine = Math.max(1, args.start_line);
            const endLine = Math.min(lines.length, args.end_line);
            content = lines.slice(startLine - 1, endLine).join('\n');
          } else if (args.start_line !== undefined) {
            const lines = content.split('\n');
            const startLine = Math.max(1, args.start_line);
            content = lines.slice(startLine - 1).join('\n');
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
            if (args.all) {
              replacedContext = contextContent.split(args.old_str).join(args.new_str);
            } else {
              replacedContext = contextContent.replace(args.old_str, args.new_str);
            }
            
            // Only replace if the context actually changed
            if (replacedContext !== contextContent) {
              const newLines = [
                ...lines.slice(0, startIndex),
                ...replacedContext.split('\n'),
                ...lines.slice(endIndex)
              ];
              content = newLines.join('\n');
            }
          } else {
            // Direct mode: replace throughout the file
            if (args.all) {
              content = content.split(args.old_str).join(args.new_str);
            } else {
              content = content.replace(args.old_str, args.new_str);
            }
          }
          
          fs.writeFileSync(filePath, content, 'utf8');
          return `✅ 已替换文件内容: ${filePath}`;
        }
        
        case "file_delete_lines": {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          
          const lines = fs.readFileSync(filePath, 'utf8').split('\n');
          const startLine = Math.max(1, args.start_line);
          const endLine = Math.min(lines.length, args.end_line);
          
          if (startLine > endLine) {
            throw new Error(`起始行不能大于结束行`);
          }
          
          const newLines = [
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