import { ToolMiddleware } from '../utils/middleware.js';
import path from 'path';
import fs from 'fs';
import { MAX_TRANSACTION_DIFF_LINES, calculateLineDiff, safeWrite, readFile } from '../runtime/executors/fileExecutor.js';
import { beginEdit, applyEdit, reviewEdit, commitEdit, cancelEdit } from '../runtime/executors/editExecutor.js';

export const fileTools = [
  { name: 'file_read', description: '读取文件。默认 full 最多 500 行；range 使用 start_line/end_line；context 使用 line/window。返回覆盖范围、截断状态和续读位置。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' }, line: { type: 'number' }, window: { type: 'number' }, mode: { type: 'string', enum: ['context', 'range', 'full'] } }, required: ['path'] } },
  { name: 'file_write', description: '写入新文件或显式覆盖文件；修改现有文件优先使用 file_patch 或编辑事务。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_append', description: '追加内容到文件末尾', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_patch', description: '小范围精确修改。字符串替换要求唯一匹配；行操作支持 replace_line/insert_line/delete_lines/replace_lines。大范围修改使用编辑事务。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, mode: { type: 'string', enum: ['context', 'range'] }, line: { type: 'number' }, window: { type: 'number' }, operation: { type: 'string', enum: ['replace_line', 'insert_line', 'delete_lines', 'replace_lines'] }, content: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, count: { type: 'number' } }, required: ['path'] } },
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
      case 'file_write': {
        const exists = fs.existsSync(filePath);
        const existing = exists ? fs.readFileSync(filePath, 'utf8') : '';
        const diff = calculateLineDiff(existing, args.content);
        const result = await safeWrite(filePath, args.content, ws, {
          expectedDiffSize: diff.changedLines,
          maxDiffLines: exists ? MAX_TRANSACTION_DIFF_LINES : Number.POSITIVE_INFINITY
        });
        return {
          ...result,
          operation: exists ? 'file_overwrite' : 'file_create',
          safetyMode: exists && diff.changedLines > 50 ? 'verified_large_write' : 'standard_write'
        };
      }
      case 'file_append': {
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        await safeWrite(filePath, existing + args.content + '\n', ws, args.content.split('\n').length);
        return `✅ 已追加内容到文件: ${filePath}`;
      }
      case 'file_patch': {
        if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
        const existing = fs.readFileSync(filePath, 'utf8');
        let next = existing;
        let matchCount = null;

        if (args.operation) {
          const lines = existing.split('\n');
          const start = Math.max(Number(args.line) || 1, 1) - 1;
          if (start > lines.length || (start === lines.length && args.operation !== 'insert_line')) {
            return { ok: false, status: 'rejected', errorCode: 'LINE_OUT_OF_RANGE', totalLines: lines.length, nextAction: 'correct_line' };
          }
          const replacementLines = Array.isArray(args.content) ? args.content : String(args.content ?? '').split('\n');
          if (args.operation === 'replace_line') lines.splice(start, 1, ...replacementLines);
          else if (args.operation === 'insert_line') lines.splice(start, 0, ...replacementLines);
          else if (args.operation === 'delete_lines') lines.splice(start, Math.max(Number(args.count) || 1, 1));
          else if (args.operation === 'replace_lines') lines.splice(start, Math.max(Number(args.count) || 1, 1), ...replacementLines);
          next = lines.join('\n');
        } else if (args.old_str !== undefined && args.new_str !== undefined) {
          if (args.old_str.length === 0) return { ok: false, status: 'rejected', errorCode: 'EMPTY_MATCH', nextAction: 'provide_unique_match' };
          matchCount = existing.split(args.old_str).length - 1;
          const requestedCount = Number(args.count) || 1;
          if (matchCount === 0) return { ok: false, status: 'not_found', errorCode: 'MATCH_NOT_FOUND', matchCount, nextAction: 'reread_target', rereadRequired: true };
          if (!args.count && matchCount !== 1) return { ok: false, status: 'ambiguous', errorCode: 'MATCH_NOT_UNIQUE', matchCount, nextAction: 'provide_context_or_count' };
          let remaining = Math.min(requestedCount, matchCount);
          next = existing.replaceAll(args.old_str, (match) => remaining-- > 0 ? args.new_str : match);
        } else {
          return { ok: false, status: 'rejected', errorCode: 'INVALID_PATCH', nextAction: 'provide_operation_or_text_replacement' };
        }

        const diff = calculateLineDiff(existing, next);
        const result = await safeWrite(filePath, next, ws, { expectedDiffSize: diff.changedLines });
        return { ...result, operation: args.operation || 'text_replace', matchCount };
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
