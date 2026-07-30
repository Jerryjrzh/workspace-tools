// src/tools/file_patch.js

import fs from 'fs';
import path from 'path';
import {
  calculateDiffLines,
  safeWriteAndCommit,
  transportEscapeCandidates,
  matchingTransportCandidate,
  countMatches,
  countNormalizedMatches,
  findFuzzyBlock,
  nearestMatch
} from './file.js';

function failure(status, errorCode, message, extra = {}) {
  return {
    ok: false,
    status,
    errorCode,
    error: message,
    nextAction: extra.nextAction || 'locate',
    nextArgs: extra.nextArgs || null,
    guidance: extra.guidance || 'Stop retrying this patch blindly. Re-read the target range or run locate with more context.',
    ...extra
  };
}

function success(operation, filePath, message, extra = {}) {
  return {
    ok: true,
    status: 'applied',
    operation,
    path: filePath,
    message,
    nextAction: extra.nextAction || 'none',
    nextArgs: extra.nextArgs || null,
    guidance: extra.guidance || null,
    ...extra
  };
}

function applyTextReplacement(existing, oldText, newText, requestedCount = 1) {
  let remaining = requestedCount;
  return existing.replaceAll(oldText, (match) => (remaining-- > 0 ? newText : match));
}

function resolveTextMatch(existing, oldStr, newStr, requestedCount = 1) {
  let effectiveOldStr = oldStr;
  let effectiveNewStr = newStr;
  let normalizedTransportEscapes = false;
  let fuzzyMatched = false;
  let matchCount = countMatches(existing, effectiveOldStr);

  if (matchCount === 0) {
    const normalizedMatch = matchingTransportCandidate(existing, effectiveOldStr);
    if (normalizedMatch) {
      effectiveOldStr = normalizedMatch.candidate;
      matchCount = normalizedMatch.matchCount;
      normalizedTransportEscapes = true;
    }
  }

  if (matchCount === 0) {
    matchCount = countNormalizedMatches(existing, effectiveOldStr);
  }

  if (matchCount === 0) {
    const fuzzy = findFuzzyBlock(existing, effectiveOldStr);
    if (fuzzy && !fuzzy.ambiguous) {
      const before = existing.slice(0, existing.indexOf(fuzzy.matchedText));
      const after = existing.slice(existing.indexOf(fuzzy.matchedText) + fuzzy.matchedText.length);
      return {
        next: before + effectiveNewStr + after,
        matchCount: 1,
        normalizedTransportEscapes,
        fuzzyMatched: true,
        fuzzyScore: fuzzy.score,
        fuzzyRange: { start_line: fuzzy.startLine, end_line: fuzzy.endLine }
      };
    }
    if (fuzzy?.ambiguous) {
      return { matchCount: 0, fuzzyAmbiguous: true, fuzzyCandidates: fuzzy.candidates };
    }
    return { matchCount: 0 };
  }

  if (normalizedTransportEscapes) {
    effectiveNewStr = transportEscapeCandidates(newStr).at(-1) || newStr;
  }

  return {
    next: applyTextReplacement(existing, effectiveOldStr, effectiveNewStr, requestedCount),
    matchCount,
    normalizedTransportEscapes,
    fuzzyMatched
  };
}

export async function file_patch(ctx, args) {
  const ws = ctx.workspace;
  if (!ws) {
    throw new Error('[file_patch] Workspace not set in context');
  }

  const filePath = path.resolve(ws, args.path);
  if (!fs.existsSync(filePath)) {
    return failure('not_found', 'FILE_NOT_FOUND', `文件不存在: ${filePath}`, {
      path: filePath,
      nextAction: 'locate',
      guidance: 'Target file was not found. Re-run locate or file search before patching.'
    });
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  if (args.operation) {
    switch (args.operation) {
      case 'replace_line': {
        if (!args.line) {
          return failure('rejected', 'MISSING_LINE', '替换行需要指定 line 参数', {
            path: filePath,
            nextAction: 'locate',
            guidance: 'Provide the exact target line number before retrying.'
          });
        }
        const lineIndex = Math.max(Number(args.line), 1) - 1;
        if (lineIndex >= lines.length) {
          return failure('rejected', 'LINE_OUT_OF_RANGE', `行号超出范围: ${args.line}，文件只有 ${lines.length} 行`, {
            path: filePath,
            nextAction: 'locate',
            guidance: `Read the file again and pick a line between 1 and ${lines.length}.`
          });
        }
        const oldContent = lines[lineIndex];
        lines[lineIndex] = args.content || '';
        const newContent = lines.join('\n');
        try {
          await safeWriteAndCommit(filePath, newContent, 1);
        } catch (e) {
          return failure('failed', e.code || 'WRITE_FAILED', e.message, {
            path: filePath,
            nextAction: 'locate',
            guidance: 'The write failed. Re-read the file before retrying.'
          });
        }
        return success('replace_line', filePath, `已替换第 ${args.line} 行`, {
          oldPreview: oldContent.slice(0, 80),
          newPreview: lines[lineIndex].slice(0, 80)
        });
      }
      case 'insert_line': {
        if (!args.line) {
          return failure('rejected', 'MISSING_LINE', '插入行需要指定 line 参数', {
            path: filePath,
            nextAction: 'locate',
            guidance: 'Provide the exact insert position before retrying.'
          });
        }
        const lineIndex = Math.max(Number(args.line), 1) - 1;
        if (lineIndex > lines.length) {
          return failure('rejected', 'LINE_OUT_OF_RANGE', `行号超出范围: ${args.line}，文件只有 ${lines.length} 行`, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        lines.splice(lineIndex, 0, args.content || '');
        try {
          await safeWriteAndCommit(filePath, lines.join('\n'), 1);
        } catch (e) {
          return failure('failed', e.code || 'WRITE_FAILED', e.message, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        return success('insert_line', filePath, `已在第 ${args.line} 行插入内容`, {
          insertedPreview: String(args.content || '').slice(0, 80)
        });
      }
      case 'delete_lines': {
        if (!args.line) {
          return failure('rejected', 'MISSING_LINE', '删除行需要指定 line 参数', {
            path: filePath,
            nextAction: 'locate'
          });
        }
        const startLine = Math.max(Number(args.line), 1) - 1;
        const deleteCount = Math.max(Number(args.count) || 1, 1);
        if (startLine >= lines.length) {
          return failure('rejected', 'LINE_OUT_OF_RANGE', `行号超出范围: ${args.line}，文件只有 ${lines.length} 行`, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        const deletedContent = lines.splice(startLine, deleteCount);
        try {
          await safeWriteAndCommit(filePath, lines.join('\n'), deleteCount + 1);
        } catch (e) {
          return failure('failed', e.code || 'WRITE_FAILED', e.message, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        return success('delete_lines', filePath, `已删除第 ${args.line}-${args.line + deleteCount - 1} 行`, {
          deletedLines: deletedContent.length
        });
      }
      case 'replace_lines': {
        if (!args.line) {
          return failure('rejected', 'MISSING_LINE', '替换行范围需要指定 line 参数', {
            path: filePath,
            nextAction: 'locate'
          });
        }
        const startLine = Math.max(Number(args.line), 1) - 1;
        const replaceCount = Math.max(Number(args.count) || 1, 1);
        if (startLine >= lines.length) {
          return failure('rejected', 'LINE_OUT_OF_RANGE', `行号超出范围: ${args.line}，文件只有 ${lines.length} 行`, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        const newLines = Array.isArray(args.content) ? args.content.map(String) : [String(args.content || '')];
        lines.splice(startLine, replaceCount, ...newLines);
        try {
          await safeWriteAndCommit(filePath, lines.join('\n'), replaceCount + 1);
        } catch (e) {
          return failure('failed', e.code || 'WRITE_FAILED', e.message, {
            path: filePath,
            nextAction: 'locate'
          });
        }
        return success('replace_lines', filePath, `已替换第 ${args.line}-${args.line + replaceCount - 1} 行`, {
          replacedLines: replaceCount
        });
      }
      default:
        return failure('rejected', 'INVALID_OPERATION', `不支持的 operation: ${args.operation}`, {
          path: filePath,
          nextAction: 'locate',
          guidance: 'Use a supported operation or switch to context mode.'
        });
    }
  }

  if (!args.line) {
    return failure('rejected', 'MISSING_LINE', 'Context 模式需要指定 line 参数', {
      path: filePath,
      nextAction: 'locate'
    });
  }

  const mode = args.mode || 'context';
  if (mode !== 'context') {
    return failure('rejected', 'INVALID_MODE', `不支持的 mode: ${args.mode}`, {
      path: filePath,
      nextAction: 'locate'
    });
  }

  const window = Math.max(Number(args.window) || 100, 1);
  const targetLine = Math.max(Number(args.line) || 1, 1);
  const half = Math.floor(window / 2);
  const start = Math.max(targetLine - half - 1, 0);
  const end = Math.min(start + window, lines.length);
  const contextLines = lines.slice(start, end);
  const contextContent = contextLines.join('\n');

  if (!contextContent.includes(args.old_str)) {
    return failure('not_found', 'MATCH_NOT_FOUND', `Context 模式未找到匹配文本: "${String(args.old_str || '').slice(0, 50)}..."`, {
      path: filePath,
      nextAction: 'locate',
      nextArgs: { path: filePath, start_line: start + 1, end_line: end },
      guidance: 'The requested text was not found in the selected context window. Re-read a narrower range or locate the text before retrying.'
    });
  }

  const patchedContext = contextContent.replace(args.old_str, args.new_str);
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  const finalContent = before + (before && !before.endsWith('\n') ? '\n' : '') + patchedContext + (after && !after.startsWith('\n') ? '\n' : '') + after;
  const expectedDiff = calculateDiffLines(contextContent, patchedContext);

  try {
    await safeWriteAndCommit(filePath, finalContent, expectedDiff);
  } catch (e) {
    return failure('failed', e.code || 'WRITE_FAILED', e.message, {
      path: filePath,
      nextAction: 'locate'
    });
  }

  return success('context_replace', filePath, `Context 模式替换完成: ${filePath}`, {
    targetLine,
    window
  });
}
