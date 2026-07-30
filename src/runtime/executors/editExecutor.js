import fs from 'fs';
import path from 'path';
import { MAX_TRANSACTION_DIFF_LINES, contentHash, safeWrite, readFile } from './fileExecutor.js';
import { checkSyntaxForContent } from './syntaxCheck.js';

const bufferPool = new Map();

function checkBrackets(content) {
  const stack = [];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const openers = Object.keys(pairs);
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (openers.includes(char)) stack.push({ char, index: i });
    else if (Object.values(pairs).includes(char)) {
      const last = stack.pop();
      if (!last || pairs[last.char] !== char) return { valid: false, error: `不匹配的括号在位置 ${i}` };
    }
  }
  return stack.length ? { valid: false, error: `未闭合的括号: ${stack.map((s) => s.char).join(', ')}` } : { valid: true };
}

function checkIndentation(lines) {
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const leading = line.match(/^[\t ]*/)[0];
    if (leading.includes('\t') && leading.includes(' ')) errors.push(`第 ${i + 1} 行：混合使用制表符和空格`);
  }
  return { valid: errors.length === 0, errors };
}

function generateDiff(filePath, newContent, startLine, endLine) {
  const oldContent = fs.readFileSync(filePath, 'utf8');
  const oldLines = oldContent.split('\n').slice(startLine - 1, endLine);
  const newLines = newContent.split('\n');
  const changes = [];
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) changes.push({ line: startLine + i, old: oldLines[i], new: newLines[i] });
  }
  return { changed: changes.length > 0, changes };
}

function normalizeRange(totalLines, startLine = 1, endLine = totalLines, windowSize = 200) {
  const safeStart = Math.max(1, Number(startLine) || 1);
  const safeEnd = Math.min(totalLines, Number(endLine) || totalLines);
  if (safeEnd >= safeStart) {
    return { startLine: safeStart, endLine: safeEnd };
  }
  const centered = Math.max(1, Math.min(totalLines, safeStart));
  const half = Math.floor(windowSize / 2);
  const computedStart = Math.max(1, centered - half);
  const computedEnd = Math.min(totalLines, computedStart + windowSize - 1);
  return { startLine: computedStart, endLine: computedEnd };
}

async function checkSyntax(language, content, filePath) {
  if (filePath) {
    return checkSyntaxForContent(content, filePath);
  }
  return { valid: true, language, length: content.length, skipped: true };
}

function mergeBufferIntoFile(currentContent, buffer) {
  const currentLines = currentContent.split('\n');
  return [...currentLines.slice(0, buffer.startLine - 1), ...buffer.content.split('\n'), ...currentLines.slice(buffer.endLine)].join('\n');
}

function checkRemovedContent(originalLines, newLines) {
  const removed = originalLines - newLines;
  return removed > 0 ? { removed, warning: `删除了 ${removed} 行内容` } : { removed: 0, warning: null };
}

export function beginEdit(filePath, args = {}) {
  const readMode = args.mode === 'context' || args.line !== undefined ? 'context' : 'range';
  const buffer = readFile(filePath, readMode, { ...args, window: args.window || 200 });
  const bufferId = `edit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  bufferPool.set(bufferId, {
    path: filePath,
    content: buffer.content,
    startLine: buffer.startLine,
    endLine: buffer.endLine,
    originalLines: buffer.content.split('\n').length,
    sourceHash: contentHash(fs.readFileSync(filePath, 'utf8')),
    createdAt: Date.now(),
    truncated: buffer.truncated === true,
    dirty: false,
    readMode
  });
  return {
    ok: true,
    status: 'ready',
    buffer_id: bufferId,
    path: filePath,
    content: buffer.content,
    start_line: buffer.startLine,
    end_line: buffer.endLine,
    buffer_line_count: buffer.content.split('\n').length,
    total_lines: buffer.totalLines,
    truncated: buffer.truncated === true,
    read_mode: readMode,
    line_numbering: 'relative_to_buffer',
    nextAction: 'edit_apply',
    nextArgs: { buffer_id: bufferId },
    guidance: `Use the exact buffer_id ${bufferId}; never invent, shorten, or rename it. replacements.line is 1..${buffer.content.split('\n').length} relative to this buffer.`
  };
}

export function applyEdit(bufferId, replacements = []) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) {
    const normalizedId = String(bufferId || '').trim();
    const fuzzyId = normalizedId ? [...bufferPool.keys()].find((id) => id.trim() === normalizedId) : null;
    if (fuzzyId) {
      bufferId = fuzzyId;
    } else {
      return {
        ok: false,
        status: 'not_found',
        errorCode: 'BUFFER_NOT_FOUND',
        error: `Buffer 不存在: ${bufferId}`,
        requested_buffer_id: bufferId,
        nextAction: 'edit_begin',
        guidance: 'The buffer is gone or never existed. Start over with edit_begin on the target file and use the returned buffer_id exactly once.'
      };
    }
  }

  const lines = buffer.content.split('\n');
  const bufferLineCount = lines.length;
  let applied = 0;
  let rejected = 0;
  const rejectedDetails = [];
  const sorted = [...replacements].sort((a, b) => (Number(a.line) || 0) - (Number(b.line) || 0));

  for (const replacement of sorted) {
    const lineNum = Math.max(Number(replacement.line) || 1, 1);
    const idx = lineNum - 1;

    if (replacement.new_content === undefined) {
      rejectedDetails.push({ line: lineNum, reason: 'missing_new_content' });
      rejected++;
      continue;
    }

    const newContent = Array.isArray(replacement.new_content)
      ? replacement.new_content.map(String).join('\n')
      : String(replacement.new_content);

    if (replacement.old_content !== undefined && idx < lines.length && lines[idx] !== replacement.old_content) {
      rejectedDetails.push({
        line: lineNum,
        reason: 'old_content_mismatch',
        expected: String(replacement.old_content).slice(0, 120),
        actual: String(lines[idx] ?? '').slice(0, 120)
      });
      rejected++;
      continue;
    }

    if (idx > lines.length) {
      rejectedDetails.push({ line: lineNum, reason: 'line_out_of_range', bufferLineCount });
      rejected++;
      continue;
    }

    if (idx === lines.length) lines.push(newContent);
    else lines[idx] = newContent;
    applied++;
  }

  buffer.content = lines.join('\n');
  buffer.dirty = buffer.dirty || applied > 0;
  bufferPool.set(bufferId, buffer);

  if (rejected > 0) {
    return {
      ok: false,
      status: 'rejected',
      errorCode: 'REPLACEMENT_VALIDATION_FAILED',
      bufferId,
      path: buffer.path,
      bufferLineCount,
      appliedReplacements: applied,
      rejectedReplacements: rejected,
      rejectedDetails,
      dirty: buffer.dirty,
      nextAction: applied > 0 ? 'edit_review' : 'edit_begin',
      guidance: applied > 0
        ? 'Some replacements were applied, but others failed validation. Review the buffer before committing or rebuild the rejected replacements from a fresh edit_begin.'
        : 'One or more replacements did not match the current buffer. Re-read the target range with edit_begin and build a fresh replacement list from the returned buffer content.'
    };
  }

  if (applied > 0) {
    return {
      ok: true,
      status: 'applied',
      bufferId,
      path: buffer.path,
      bufferLineCount,
      appliedReplacements: applied,
      rejectedReplacements: 0,
      dirty: buffer.dirty,
      nextAction: 'edit_review',
      guidance: 'The edit was applied to the buffer. Run edit_review before edit_commit to validate syntax.'
    };
  }

  return {
    ok: true,
    status: 'unchanged',
    bufferId,
    path: buffer.path,
    bufferLineCount,
    appliedReplacements: 0,
    rejectedReplacements: 0,
    dirty: buffer.dirty,
    nextAction: 'edit_begin',
    guidance: 'No replacements were applied. Re-read the target range and rebuild the replacement list.'
  };
}

export async function reviewEdit(bufferId, language = null) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) return { error: `Buffer 不存在: ${bufferId}` };
  const lines = buffer.content.split('\n');
  const bracketCheck = checkBrackets(buffer.content);
  const syntax = await checkSyntax(language, buffer.content, buffer.path);
  const readyToCommit = bracketCheck.valid && syntax.valid !== false;
  return {
    ok: readyToCommit,
    bufferId,
    path: buffer.path,
    bufferLineCount: lines.length,
    checks: {
      brackets: bracketCheck,
      indentation: checkIndentation(lines),
      diff: generateDiff(buffer.path, buffer.content, buffer.startLine, buffer.endLine),
      syntax,
      removedContent: checkRemovedContent(buffer.originalLines, lines.length)
    },
    nextAction: readyToCommit ? 'edit_commit' : 'edit_apply',
    guidance: readyToCommit
      ? 'Syntax and bracket checks passed; proceed with edit_commit.'
      : 'Fix reported syntax/bracket issues before edit_commit. Do not commit broken code.'
  };
}

export async function commitEdit(bufferId, workspace = null) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) return { ok: false, status: 'not_found', errorCode: 'BUFFER_NOT_FOUND', error: `Buffer 不存在: ${bufferId}` };
  const filePath = path.resolve(workspace || process.cwd(), buffer.path);
  const currentContent = fs.readFileSync(filePath, 'utf8');
  if (contentHash(currentContent) !== buffer.sourceHash) {
    return {
      ok: false,
      status: 'conflict',
      errorCode: 'SOURCE_CHANGED',
      path: filePath,
      nextAction: 'edit_cancel_and_reread',
      rereadRequired: true,
      guidance: 'File changed since edit_begin. Call edit_cancel, reread the target range, then edit_begin again.'
    };
  }
  if (!buffer.dirty) {
    return { ok: true, status: 'unchanged', path: filePath, changed: false, nextAction: 'none', rereadRequired: false };
  }

  if (buffer.content === undefined || buffer.content === null) {
    return {
      ok: false,
      status: 'rejected',
      errorCode: 'BUFFER_EMPTY',
      path: filePath,
      nextAction: 'edit_begin',
      guidance: 'The edit buffer is empty or corrupted. Start over with edit_begin.'
    };
  }

  const mergedContent = mergeBufferIntoFile(currentContent, buffer);
  const bracketCheck = checkBrackets(mergedContent);
  if (!bracketCheck.valid) {
    return {
      ok: false,
      status: 'rejected',
      errorCode: 'BRACKET_MISMATCH',
      path: filePath,
      checks: { brackets: bracketCheck },
      nextAction: 'edit_apply',
      guidance: 'Merged content has unmatched brackets. Fix in edit_apply before commit.'
    };
  }

  const syntax = await checkSyntax(null, mergedContent, filePath);
  if (syntax.valid === false) {
    return {
      ok: false,
      status: 'rejected',
      errorCode: 'SYNTAX_ERROR',
      path: filePath,
      checks: { syntax },
      nextAction: 'edit_apply',
      guidance: syntax.guidance || 'Fix syntax errors before edit_commit.'
    };
  }

  const result = await safeWrite(filePath, mergedContent, workspace, { maxDiffLines: MAX_TRANSACTION_DIFF_LINES });
  bufferPool.delete(bufferId);
  return { ...result, operation: 'edit_commit', bufferId };
}

export function cancelEdit(bufferId) {
  if (bufferPool.has(bufferId)) {
    bufferPool.delete(bufferId);
    return `✅ 编辑会话已取消: ${bufferId}`;
  }
  return `⚠️ Buffer 不存在: ${bufferId}`;
}

export { bufferPool };
