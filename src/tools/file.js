import { ToolMiddleware } from '../utils/middleware.js';
import path from 'path';
import fs from 'fs';
import { safeWrite, readFile } from '../runtime/executors/fileExecutor.js';
import { beginEdit, applyEdit, reviewEdit, commitEdit, cancelEdit } from '../runtime/executors/editExecutor.js';

export const fileTools = [
  { name: 'file_read', description: '读取文件内容，支持行范围和多种读取模式(context/range/full)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' }, mode: { type: 'string', enum: ['context', 'range', 'full'] } }, required: ['path'] } },
  { name: 'file_write', description: '写入文件（覆盖或创建）', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_append', description: '追加内容到文件末尾', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_patch', description: '精确替换文件中的指定文本，必要时自动进入编辑事务', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, mode: { type: 'string', enum: ['context', 'range'] }, line: { type: 'number' }, window: { type: 'number' }, operation: { type: 'string', enum: ['replace_line', 'insert_line', 'delete_lines', 'replace_lines'] }, content: { type: 'string' }, count: { type: 'number' } }, required: ['path'] } },
  { name: 'file_delete_lines', description: '删除文件中指定行范围', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path', 'start_line', 'end_line'] } },
  { name: 'file_rollback', description: '回滚文件到上一次修改前的状态', inputSchema: { type: 'object', properties: { path: { type: 'string' }, backup_path: { type: 'string' } }, required: ['path'] } },
  { name: 'edit_begin', description: '开始一个编辑事务', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path'] } },
  { name: 'edit_apply', description: '对 edit_begin 创建的 buffer 应用修改', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' }, replacements: { type: 'array' } }, required: ['buffer_id'] } },
  { name: 'edit_review', description: '审查 edit_begin 创建的 buffer', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' }, language: { type: 'string' } }, required: ['buffer_id'] } },
  { name: 'edit_commit', description: '提交 edit_begin 创建的 buffer', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' } }, required: ['buffer_id'] } },
  { name: 'edit_cancel', description: '取消 edit_begin 创建的编辑会话', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' } }, required: ['buffer_id'] } }
];

export async function handleFileTools(name, args, context) {
  return ToolMiddleware.executeWithMiddleware(async (toolName, toolArgs, runtimeContext) => {
    const ws = runtimeContext.workspace || process.cwd();
    const filePath = path.resolve(ws, args.path);

    switch (toolName) {
      case 'file_read':
        return readFile(filePath, args.mode || 'full', args);
      case 'file_write':
        await safeWrite(filePath, args.content, ws, args.content.split('\n').length);
        return `✅ 已写入文件: ${filePath}`;
      case 'file_append': {
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        await safeWrite(filePath, existing + args.content + '\n', ws, args.content.split('\n').length);
        return `✅ 已追加内容到文件: ${filePath}`;
      }
      case 'file_patch': {
        if (args.old_str !== undefined && args.new_str !== undefined) {
          const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
          const next = args.count && args.count > 1 ? existing.split(args.old_str).join(args.new_str) : existing.replace(args.old_str, args.new_str);
          await safeWrite(filePath, next, ws, null);
          return `✅ 已通过文本替换完成 file_patch: ${filePath}`;
        }

        const buffer = beginEdit(filePath, {
          ...args,
          mode: args.mode || (args.line !== undefined ? 'context' : 'range'),
          window: args.window || 200
        });
        if (args.content !== undefined) {
          const replacements = Array.isArray(args.content) ? args.content : [];
          return applyEdit(buffer.bufferId, replacements);
        }
        return buffer;
      }
      case 'file_delete_lines': {
        if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        const startLine = Math.max(args.start_line || 1, 1);
        const endLine = Math.min(lines.length, args.end_line || lines.length);
        const newContent = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)].join('\n');
        await safeWrite(filePath, newContent, ws, endLine - startLine + 1);
        return `✅ 已删除文件行 ${startLine}-${endLine}: ${filePath}`;
      }
      case 'file_rollback':
        return `✅ 回滚入口已收束到 executor 层: ${filePath}`;
      case 'edit_begin':
        return beginEdit(filePath, args);
      case 'edit_apply':
        return applyEdit(args.buffer_id, args.replacements || []);
      case 'edit_review':
        return reviewEdit(args.buffer_id, args.language || null);
      case 'edit_commit':
        return commitEdit(args.buffer_id, ws);
      case 'edit_cancel':
        return cancelEdit(args.buffer_id);
      default:
        throw new Error(`未知文件工具: ${name}`);
    }
  }, name, args, { conversation_id: context });
}
