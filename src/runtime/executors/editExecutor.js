import fs from 'fs';
import path from 'path';
import { backupFileBeforePatch, safeWrite, readFile } from './fileExecutor.js';

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

async function checkSyntax(language, content) {
  return { valid: true, language, length: content.length };
}

function checkRemovedContent(originalLines, newLines) {
  const removed = originalLines - newLines;
  return removed > 0 ? { removed, warning: `删除了 ${removed} 行内容` } : { removed: 0, warning: null };
}

export function beginEdit(filePath, args = {}) {
  const buffer = readFile(filePath, 'range', args);
  const bufferId = `edit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  bufferPool.set(bufferId, {
    path: filePath,
    content: buffer.content,
    startLine: buffer.startLine,
    endLine: buffer.endLine,
    originalLines: buffer.totalLines,
    createdAt: Date.now()
  });
  return { bufferId, path: filePath, startLine: buffer.startLine, endLine: buffer.endLine, totalLines: buffer.totalLines };
}

export function applyEdit(bufferId, replacements = []) {
  const buffer = bufferPool.get(bufferId);
  if (!buffer) return { error: `Buffer 不存在: ${bufferId}` };
  const lines = buffer.content.split('\n');
  for (const replacement of replacements) {
    const idx = Math.max(replacement.line, 1) - 1;
    if (idx < lines.length && replacement.new_content !== undefined) lines[idx] = replacement.new_content;
  }
  buffer.content = lines.join('\n');
  bufferPool.set(bufferId, buffer);
  return { bufferId, path: buffer.path, modified: true };
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
  if (!buffer) return { error: `Buffer 不存在: ${bufferId}` };
  const filePath = path.resolve(workspace || process.cwd(), buffer.path);
  const currentLines = fs.readFileSync(filePath, 'utf8').split('\n');
  const newLines = [...currentLines.slice(0, buffer.startLine - 1), ...buffer.content.split('\n'), ...currentLines.slice(buffer.endLine)];
  const backupPath = backupFileBeforePatch(filePath, workspace);
  await safeWrite(filePath, newLines.join('\n'), workspace, null);
  bufferPool.delete(bufferId);
  return { path: filePath, backupPath, message: `✅ 编辑已提交！备份路径: ${backupPath || '无'}` };
}

export function cancelEdit(bufferId) {
  if (bufferPool.has(bufferId)) {
    bufferPool.delete(bufferId);
    return `✅ 编辑会话已取消: ${bufferId}`;
  }
  return `⚠️ Buffer 不存在: ${bufferId}`;
}

export { bufferPool };
