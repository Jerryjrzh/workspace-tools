import fs from 'fs';
import path from 'path';

const WRITE_TOOLS = new Set(['file_patch', 'file_write']);
const FILE_TOOLS = new Set(['file_patch', 'file_write', 'file_read']);

function ensureBackupPath(filePath) {
  const backupDir = path.join(path.dirname(filePath), '.lmstudio-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(filePath)}_${timestamp}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export async function GuardStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !FILE_TOOLS.has(toolName)) {
    return next();
  }

  if (!ctx.workspace) {
    throw new Error('[Guard] Workspace not set before file tool execution');
  }

  const targetPath = req.args?.path;
  if (!targetPath) {
    throw new Error(`[Guard] Tool ${toolName} missing required argument: path`);
  }

  const absolutePath = path.resolve(ctx.workspace, targetPath);
  if (!absolutePath.startsWith(ctx.workspace)) {
    throw new Error(`[Guard] 越权访问拒绝: 试图访问 workspace 外部的路径 (${absolutePath})`);
  }

  if (WRITE_TOOLS.has(toolName) && fs.existsSync(absolutePath)) {
    const backupPath = ensureBackupPath(absolutePath);
    ctx.state = ctx.state || {};
    ctx.state.guardBackups = ctx.state.guardBackups || [];
    ctx.state.guardBackups.push(backupPath);
  }

  return next();
}
