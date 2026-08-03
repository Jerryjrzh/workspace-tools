import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BACKUP_DIR = '.lmstudio-backups';
const MAX_DIFF_LINES = 50;
const MAX_TRANSACTION_DIFF_LINES = 500;
const DEFAULT_FULL_READ_LINE_LIMIT = 500;

function contentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function backupFileBeforePatch(filePath, workspace) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const ws = workspace || process.cwd();
  const backupDirPath = path.join(ws, BACKUP_DIR);
  ensureDir(backupDirPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = path.basename(filePath);
  const backupPath = path.join(backupDirPath, `${fileName}_${timestamp}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function calculateLineDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;

  const deletedLines = Math.max(0, oldLines.length - prefix - suffix);
  const addedLines = Math.max(0, newLines.length - prefix - suffix);
  return {
    changedLines: Math.max(deletedLines, addedLines),
    addedLines,
    deletedLines,
    changed: deletedLines > 0 || addedLines > 0,
    oldStart: prefix + 1,
    oldEnd: prefix + deletedLines,
    newStart: prefix + 1,
    newEnd: prefix + addedLines
  };
}

function calculateDiffLines(oldContent, newContent) {
  return calculateLineDiff(oldContent, newContent).changedLines;
}

async function runCompileCheck(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const { execFile } = await import('child_process');
  const execCheck = (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ checked: true, command });
        return;
      }
      err.command = command;
      err.output = stderr || stdout || err.message;
      reject(err);
    });
  });

  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    return execCheck(process.execPath, ['--check', filePath]);
  }
  if (ext === '.py') {
    const unavailableCommands = [];
    for (const pythonCmd of ['python3', 'python']) {
      try {
        return await execCheck(pythonCmd, ['-m', 'py_compile', filePath]);
      } catch (error) {
        if (error.code === 'ENOENT') {
          unavailableCommands.push(pythonCmd);
          continue;
        }
        const validationError = new Error(error.output || error.message);
        validationError.code = 'SYNTAX_CHECK_FAILED';
        validationError.cause = error;
        throw validationError;
      }
    }
    return {
      checked: false,
      skipped: true,
      reason: 'validator_unavailable',
      unavailableCommands
    };
  }
  return { checked: false, skipped: true, reason: 'unsupported_extension' };
}

async function safeWrite(filePath, newContent, workspace, options = {}) {
  const normalizedOptions = typeof options === 'number' || options === null
    ? { expectedDiffSize: options }
    : options;
  const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const diff = calculateLineDiff(oldContent, newContent);
  const maxDiffLines = normalizedOptions.maxDiffLines ?? MAX_DIFF_LINES;
  if (diff.changedLines > maxDiffLines) {
    const error = new Error(`修改规模超过 ${maxDiffLines} 行安全限制。实际变更: ${diff.changedLines} 行`);
    error.code = 'PATCH_TOO_LARGE';
    error.details = diff;
    throw error;
  }

  const dir = path.dirname(filePath);
  ensureDir(dir);
  const backupPath = backupFileBeforePatch(filePath, workspace);
  const hashBefore = contentHash(oldContent);
  const tempPath = `${filePath}.lmstudio-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, newContent, 'utf8');
  fs.renameSync(tempPath, filePath);

  let compileValidation;
  try {
    compileValidation = await runCompileCheck(filePath);
  } catch (error) {
    if (backupPath && fs.existsSync(backupPath)) fs.copyFileSync(backupPath, filePath);
    throw error;
  }

  const writtenContent = fs.readFileSync(filePath, 'utf8');
  const hashAfter = contentHash(writtenContent);
  if (hashAfter !== contentHash(newContent)) {
    if (backupPath && fs.existsSync(backupPath)) fs.copyFileSync(backupPath, filePath);
    throw new Error(`写入验证失败: ${filePath}`);
  }

  return {
    ok: true,
    status: 'committed',
    path: filePath,
    changed: diff.changed,
    ...diff,
    backupPath,
    hashBefore,
    hashAfter,
    expectedDiffSize: normalizedOptions.expectedDiffSize ?? null,
    validation: {
      writeVerified: true,
      syntaxChecked: compileValidation?.checked === true,
      syntaxOk: compileValidation?.checked === true ? true : null,
      syntaxCheckSkipped: compileValidation?.skipped === true,
      syntaxCheckReason: compileValidation?.reason || null,
      unavailableValidators: compileValidation?.unavailableCommands || []
    },
    nextAction: 'none',
    rereadRequired: false
  };
}

function readFile(filePath, mode = 'full', options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const hasExplicitRange = options.start_line !== undefined || options.end_line !== undefined || options.line !== undefined;
  const effectiveMode = mode || (hasExplicitRange ? 'range' : 'full');

  let startLine = 1;
  let endLine = totalLines;
  let buffered = false;
  let clampedRange = null;

  if (effectiveMode === 'context' && options.line !== undefined) {
    const target = Math.max(0, Math.min(totalLines - 1, Number(options.line) - 1));
    const windowSize = Math.max(1, Number(options.window) || DEFAULT_FULL_READ_LINE_LIMIT);
    const half = Math.floor(windowSize / 2);
    startLine = Math.max(1, target - half + 1);
    endLine = Math.min(totalLines, startLine + windowSize - 1);
    buffered = true;
  } else if (effectiveMode === 'range' || hasExplicitRange) {
    const requestedStart = Number(options.start_line) || 1;
    const requestedEnd = Number(options.end_line) || totalLines;

    // Clamp out-of-bounds ranges instead of returning an empty slice. A start beyond the
    // file end (or a reversed range) previously produced startLine > endLine with no content,
    // which callers interpreted as a failed read.
    if (requestedStart > totalLines || requestedEnd < 1) {
      clampedRange = { requested: { start_line: options.start_line, end_line: options.end_line }, resolved: null };
      return {
        ok: false,
        status: 'out_of_bounds',
        operation: 'file_read',
        path: filePath,
        totalLines,
        errorCode: 'RANGE_OUT_OF_BOUNDS',
        requestedRange: { start_line: options.start_line, end_line: options.end_line },
        clampedRange: null,
        nextAction: 'correct_range',
        guidance: `请求的行范围 ${requestedStart}-${requestedEnd} 超出文件范围（共 ${totalLines} 行）。请使用 ≤ ${totalLines} 的 start_line/end_line，或改用 mode=full / context。`
      };
    }

    const clampedStart = Math.max(1, requestedStart);
    const clampedEnd = Math.min(totalLines, requestedEnd);
    if (clampedStart !== requestedStart || clampedEnd !== requestedEnd) {
      clampedRange = { requested: { start_line: options.start_line, end_line: options.end_line }, resolved: { start_line: clampedStart, end_line: clampedEnd } };
    }
    startLine = Math.min(clampedStart, totalLines);
    endLine = Math.max(Math.min(clampedEnd, totalLines), 1);
    buffered = true;
  } else if (effectiveMode === 'full') {
    if (totalLines > DEFAULT_FULL_READ_LINE_LIMIT) {
      endLine = DEFAULT_FULL_READ_LINE_LIMIT;
      buffered = true;
    }
  }

  const rangeContent = lines.slice(startLine - 1, endLine).join('\n');
  const truncated = endLine < totalLines;
  return {
    ok: true,
    status: 'read',
    operation: 'file_read',
    bufferId: buffered ? `buf_${Date.now()}` : null,
    path: filePath,
    startLine,
    endLine,
    totalLines,
    content: rangeContent,
    truncated,
    nextStartLine: truncated ? endLine + 1 : null,
    clampedRange,
    mode: effectiveMode,
    nextAction: truncated ? 'continue_or_target' : (clampedRange ? 'range_clamped' : 'none')
  };
}

export {
  BACKUP_DIR,
  MAX_DIFF_LINES,
  MAX_TRANSACTION_DIFF_LINES,
  contentHash,
  calculateLineDiff,
  safeWrite,
  readFile,
  backupFileBeforePatch
};
