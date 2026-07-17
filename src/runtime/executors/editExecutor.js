import fs from 'fs';
import path from 'path';
import { MAX_TRANSACTION_DIFF_LINES, contentHash, safeWrite, readFile } from './fileExecutor.js';

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

async function checkSyntax(language, content) {
  return { valid: true, language, length: content.length };
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
    originalLines: buffer.totalLines,
    sourceHash: contentHash(fs.readFileSync(filePath, 'utf8')),
    createdAt: Date.now(),
    truncated: buffer.truncated === true,
    dirty: false,
    readMode
  });
  return {
    bufferId,
    path: filePath,
    startLine: buffer.startLine,
    endLine: buffer.endLine,
    totalLines: buffer.totalLines,
    truncated: buffer.truncated === true,
    readMode
  };
}

export function applyEdit(bufferId, replacements = []) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) return { ok: false, status: 'not_found', errorCode: 'BUFFER_NOT_FOUND', error: `Buffer 不存在: ${bufferId}` };
  const lines = buffer.content.split('\n');
  let applied = 0;
  let rejected = 0;
  for (const replacement of replacements) {
    const idx = Math.max(Number(replacement.line) || 1, 1) - 1;
    if (idx < lines.length && replacement.new_content !== undefined) {
      lines[idx] = replacement.new_content;
      applied++;
    } else rejected++;
  }
  buffer.content = lines.join('\n');
  buffer.dirty = buffer.dirty || applied > 0;
  bufferPool.set(bufferId, buffer);
  return {
    ok: rejected === 0,
    status: applied > 0 ? 'applied' : 'unchanged',
    bufferId,
    path: buffer.path,
    appliedReplacements: applied,
    rejectedReplacements: rejected,
    dirty: buffer.dirty,
    nextAction: applied > 0 ? 'edit_review' : 'correct_replacements'
  };
}

export async function reviewEdit(bufferId, language = null) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) return { error: `Buffer 不存在: ${bufferId}` };
  const lines = buffer.content.split('\n');
  return {
    bufferId,
    path: buffer.path,
    checks: {
      brackets: checkBrackets(buffer.content),
      indentation: checkIndentation(lines),
      diff: generateDiff(buffer.path, buffer.content, buffer.startLine, buffer.endLine),
      syntax: language ? await checkSyntax(language, buffer.content) : null,
      removedContent: checkRemovedContent(buffer.originalLines, lines.length)
    }
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
      rereadRequired: true
    };
  }
  if (!buffer.dirty) {
    return { ok: true, status: 'unchanged', path: filePath, changed: false, nextAction: 'none', rereadRequired: false };
  }
  const currentLines = currentContent.split('\n');
  const newLines = [...currentLines.slice(0, buffer.startLine - 1), ...buffer.content.split('\n'), ...currentLines.slice(buffer.endLine)];
  const result = await safeWrite(filePath, newLines.join('\n'), workspace, { maxDiffLines: MAX_TRANSACTION_DIFF_LINES });
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
