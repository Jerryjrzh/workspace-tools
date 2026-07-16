import fs from 'fs';
import path from 'path';

const BACKUP_DIR = '.lmstudio-backups';
const MAX_DIFF_LINES = 50;

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

function calculateDiffLines(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let diffCount = 0;

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      diffCount++;
    }
  }

  return diffCount;
}

async function runCompileCheck(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
    return;
  }

  const { execFile } = await import('child_process');
  if (['.js', '.mjs'].includes(ext)) {
    return new Promise((resolve, reject) => {
      execFile('node', ['--check', filePath], { timeout: 10000 }, (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function safeWrite(filePath, newContent, workspace, expectedDiffSize = null) {
  const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const diffLines = calculateDiffLines(oldContent, newContent);
  if (diffLines > MAX_DIFF_LINES) {
    throw new Error(`❌ 修改行数超过 ${MAX_DIFF_LINES} 行安全限制。实际变更: ${diffLines} 行`);
  }

  const dir = path.dirname(filePath);
  ensureDir(dir);
  const backupPath = backupFileBeforePatch(filePath, workspace);
  fs.writeFileSync(filePath, newContent, 'utf8');

  try {
    await runCompileCheck(filePath);
  } catch (error) {
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
    }
    throw error;
  }

  return { backupPath, diffLines, expectedDiffSize };
}

function readFile(filePath, mode = 'full', options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  let startLine = 1;
  let endLine = totalLines;

  if (mode === 'context' && options.line !== undefined) {
    const target = Math.max(0, Math.min(totalLines - 1, options.line - 1));
    const windowSize = options.window || 100;
    const half = Math.floor(windowSize / 2);
    startLine = Math.max(1, target - half + 1);
    endLine = Math.min(totalLines, startLine + windowSize - 1);
  } else if (mode === 'range' || (options.start_line !== undefined && options.end_line !== undefined)) {
    startLine = Math.max(1, options.start_line || 1);
    endLine = Math.min(totalLines, options.end_line || totalLines);
  }

  const rangeContent = lines.slice(startLine - 1, endLine).join('\n');
  if (mode === 'full') {
    return rangeContent;
  }

  return { bufferId: `buf_${Date.now()}`, path: filePath, startLine, endLine, totalLines, content: rangeContent };
}

export { BACKUP_DIR, MAX_DIFF_LINES, safeWrite, readFile, backupFileBeforePatch };
