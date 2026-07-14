import fs from 'fs';
import path from 'path';

function ensureBackupPath(filePath) {
  const backupDir = path.join(path.dirname(filePath), '.lmstudio-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(filePath)}_${timestamp}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export async function BackupPolicyStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !['file_patch', 'file_write'].includes(toolName)) {
    return next();
  }

  const absolutePath = ctx.state?.absolutePath || path.resolve(ctx.workspace, req.args?.path || '');
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return next();
  }

  const backupPath = ensureBackupPath(absolutePath);
  ctx.state = ctx.state || {};
  ctx.state.guardBackups = ctx.state.guardBackups || [];
  ctx.state.guardBackups.push(backupPath);
  return next();
}
