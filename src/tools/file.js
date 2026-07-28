import { ToolMiddleware } from '../utils/middleware.js';
import path from 'path';
import fs from 'fs';
import { MAX_TRANSACTION_DIFF_LINES, calculateLineDiff, safeWrite, readFile } from '../runtime/executors/fileExecutor.js';
import { beginEdit, applyEdit, reviewEdit, commitEdit, cancelEdit } from '../runtime/executors/editExecutor.js';

const recentReads = new Map();
const MAX_READ_CACHE_ENTRIES = 200;

function trackRead(sessionId, result) {
  const key = `${sessionId || 'default'}:${result.path}`;
  const previous = recentReads.get(key);
  const redundant = previous && result.startLine >= previous.startLine && result.endLine <= previous.endLine;
  recentReads.set(key, { startLine: result.startLine, endLine: result.endLine, at: Date.now() });
  if (recentReads.size > MAX_READ_CACHE_ENTRIES) recentReads.delete(recentReads.keys().next().value);
  return redundant ? {
    ...result,
    redundantRead: true,
    guidance: `Range ${result.startLine}-${result.endLine} was already covered by ${previous.startLine}-${previous.endLine}; use the previous result unless the file changed.`
  } : result;
}

export const fileTools = [
  { name: 'file_read', description: '读取文件。默认 full 最多 500 行；range 使用 start_line/end_line；context 使用 line/window。返回覆盖范围、截断状态和续读位置。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' }, line: { type: 'number' }, window: { type: 'number' }, mode: { type: 'string', enum: ['context', 'range', 'full'] } }, required: ['path'] } },
  { name: 'file_write', description: '写入新文件或显式覆盖文件；修改现有文件优先使用 file_patch 或编辑事务。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_append', description: '追加内容到文件末尾', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_patch', description: '小范围精确修改。old_str/new_str 使用源码原文，不要手工添加 JSON 反斜杠或字面量\\n；工具会兼容误传的引号与换行转义。MATCH_NOT_FOUND 后必须按 nextAction 调用 edit_begin，禁止重复同一补丁；MATCH_NOT_UNIQUE 按 occurrence_lines 选择行操作。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string', description: 'Literal source text, with ordinary quote characters; do not add transport escaping.' }, new_str: { type: 'string', description: 'Literal replacement source text; do not add transport escaping.' }, mode: { type: 'string', enum: ['context', 'range'] }, line: { type: 'number' }, window: { type: 'number' }, operation: { type: 'string', enum: ['replace_line', 'insert_line', 'delete_lines', 'replace_lines'] }, content: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, count: { type: 'number' } }, required: ['path'] } },
  { name: 'file_delete_lines', description: '删除文件中指定行范围', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path', 'start_line', 'end_line'] } },
  { name: 'file_rollback', description: '回滚文件到上一次修改前的状态', inputSchema: { type: 'object', properties: { path: { type: 'string' }, backup_path: { type: 'string' } }, required: ['path'] } },
  { name: 'edit_begin', description: '开始范围编辑事务。返回 metadata 中的 buffer_id 和 nextArgs；后续必须原样复制该 buffer_id，禁止猜测 edit_buffer_1、eb1、b1 等别名。源码位于独立 text 内容中。', inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path'] } },
  { name: 'edit_apply', description: '对 buffer 批量应用行替换。buffer_id 必须逐字符复制 edit_begin 返回的 nextArgs.buffer_id；replacements 的 line 是相对 buffer 的 1-based 行号。', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string', description: 'Exact opaque ID from edit_begin.nextArgs.buffer_id; never abbreviate or invent.' }, replacements: { type: 'array', items: { type: 'object', properties: { line: { type: 'number' }, new_content: { type: 'string' } }, required: ['line', 'new_content'] } } }, required: ['buffer_id', 'replacements'] } },
  { name: 'edit_review', description: '审查 edit_begin 创建的 buffer', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' }, language: { type: 'string' } }, required: ['buffer_id'] } },
  { name: 'edit_commit', description: '提交 edit_begin 创建的 buffer', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' } }, required: ['buffer_id'] } },
  { name: 'edit_cancel', description: '取消 edit_begin 创建的编辑会话', inputSchema: { type: 'object', properties: { buffer_id: { type: 'string' } }, required: ['buffer_id'] } }
];

function transportEscapeCandidates(value) {
  const text = String(value);
  const candidates = [];
  const add = (candidate) => {
    if (candidate !== text && !candidates.includes(candidate)) candidates.push(candidate);
  };

  add(text.replace(/\\+(?=["'])/g, ''));
  add(text
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\\+r/g, '\r')
    .replace(/\\+t/g, '\t')
    .replace(/\\+(?=["'])/g, ''));
  return candidates;
}

function matchingTransportCandidate(content, target) {
  for (const candidate of transportEscapeCandidates(target)) {
    const matchCount = countMatches(content, candidate);
    if (matchCount > 0) return { candidate, matchCount };
  }
  return null;
}

function countMatches(content, target) {
  return target.length === 0 ? 0 : content.split(target).length - 1;
}

function nearestMatch(existing, target, window = 3) {
  const lines = existing.split('\n');
  const targetLines = String(target).trim().split('\n').map((line) => line.trim()).filter(Boolean);
  const significantLines = targetLines.filter((line) => line.length >= 12);
  const tokens = [...new Set(significantLines.join(' ').match(/[A-Za-z_]\w{3,}/g) || [])];
  let best = { score: 0, index: -1 };
  lines.forEach((line, index) => {
    const block = lines.slice(index, index + Math.max(targetLines.length, 1)).join('\n');
    const lineHits = significantLines.reduce((total, needle) => total + (block.includes(needle) ? 8 : 0), 0);
    const tokenHits = tokens.reduce((total, token) => total + (block.includes(token) ? 1 : 0), 0);
    const score = lineHits + tokenHits;
    if (score > best.score) best = { score, index };
  });
  if (best.index < 0 || best.score === 0) return null;
  const start = Math.max(0, best.index - window);
  const end = Math.min(lines.length, best.index + Math.max(targetLines.length, 1) + window);
  return { line: best.index + 1, startLine: start + 1, endLine: end, content: lines.slice(start, end).join('\n') };
}

export async function handleFileTools(name, args, context) {
  return ToolMiddleware.executeWithMiddleware(async (toolName, toolArgs, runtimeContext) => {
    const ws = runtimeContext.workspace || process.cwd();
    const pathlessEditTools = new Set(['edit_apply', 'edit_review', 'edit_commit', 'edit_cancel']);
    const filePath = pathlessEditTools.has(toolName) ? null : path.resolve(ws, args.path);

    switch (toolName) {
      case 'file_read':
        return trackRead(runtimeContext.sessionId, readFile(filePath, args.mode || 'full', args));
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
          let effectiveOldStr = args.old_str;
          let normalizedTransportEscapes = false;
          matchCount = countMatches(existing, effectiveOldStr);
          if (matchCount === 0) {
            const normalizedMatch = matchingTransportCandidate(existing, effectiveOldStr);
            if (normalizedMatch) {
              effectiveOldStr = normalizedMatch.candidate;
              matchCount = normalizedMatch.matchCount;
              normalizedTransportEscapes = true;
            }
          }
          const requestedCount = Number(args.count) || 1;
          if (matchCount === 0) {
            const nearestTarget = transportEscapeCandidates(args.old_str).at(-1) || args.old_str;
            const nearest = nearestMatch(existing, nearestTarget);
            return {
              ok: false,
              status: 'not_found',
              errorCode: 'MATCH_NOT_FOUND',
              matchCount,
              nextAction: nearest ? 'edit_begin' : 'locate',
              nextArgsMode: nearest ? 'range' : 'search',
              nextArgs: nearest ? { path: filePath, start_line: nearest.startLine, end_line: nearest.endLine } : null,
              rereadRequired: false,
              nearestMatch: nearest,
              suggestedRange: nearest ? { start_line: nearest.startLine, end_line: nearest.endLine } : null,
              guidance: nearest
                ? 'Call edit_begin exactly once with nextArgs, then copy its nextArgs.buffer_id exactly into edit_apply. Do not retry escaped old_str.'
                : 'Use locate or file_search to find the symbol before editing.'
            };
          }
          if (!args.count && matchCount !== 1) {
            const occurrenceLines = [];
            let searchFrom = 0;
            while (occurrenceLines.length < 20) {
              const index = existing.indexOf(effectiveOldStr, searchFrom);
              if (index < 0) break;
              occurrenceLines.push(existing.slice(0, index).split('\n').length);
              searchFrom = index + Math.max(effectiveOldStr.length, 1);
            }
            return {
              ok: false,
              status: 'ambiguous',
              errorCode: 'MATCH_NOT_UNIQUE',
              matchCount,
              occurrence_lines: occurrenceLines,
              nextAction: 'choose_occurrence',
              nextArgs: { path: filePath, old_str: args.old_str, new_str: args.new_str, count: 1 },
              alternatives: occurrenceLines.map((line) => ({ operation: 'replace_lines', line, count: effectiveOldStr.split('\n').length, content: args.new_str })),
              guidance: 'Do not retry the same ambiguous patch. Select the intended occurrence by surrounding context, then use the returned occurrence_lines or one line-based alternative; if you need a different region, reread that range first.',
              fallbackAllowed: true
            };
          }
          let remaining = Math.min(requestedCount, matchCount);
          const effectiveNewStr = normalizedTransportEscapes
            ? (transportEscapeCandidates(args.new_str).at(-1) || args.new_str)
            : args.new_str;
          next = existing.replaceAll(effectiveOldStr, (match) => remaining-- > 0 ? effectiveNewStr : match);
          args._normalizedTransportEscapes = normalizedTransportEscapes;
        } else {
          return { ok: false, status: 'rejected', errorCode: 'INVALID_PATCH', nextAction: 'provide_operation_or_text_replacement' };
        }

        const diff = calculateLineDiff(existing, next);
        const result = await safeWrite(filePath, next, ws, {
          expectedDiffSize: diff.changedLines,
          maxDiffLines: MAX_TRANSACTION_DIFF_LINES
        });
        return {
          ...result,
          operation: args.operation || 'text_replace',
          matchCount,
          normalizedTransportEscapes: args._normalizedTransportEscapes === true,
          safetyMode: diff.changedLines > 50 ? 'verified_large_patch' : 'standard_patch',
          fallbackAllowed: true
        };
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
  }, name, args, { conversation_id: context?.sessionId || context?.conversation_id || context });
}
