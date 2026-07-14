import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export async function SyntaxPolicyStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !['file_patch', 'file_write'].includes(toolName)) {
    return next();
  }

  const absolutePath = ctx.state?.absolutePath || path.resolve(ctx.workspace, req.args?.path || '');
  const content = req.args?.content || null;

  if (!content || !absolutePath) {
    return next();
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs' && ext !== '.ts') {
    return next();
  }

  const tmpFile = path.join(ctx.workspace || process.cwd(), `.syntax-check-${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, content, 'utf8');

  try {
    const result = spawnSync(process.execPath, ['--check', tmpFile], {
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error(`[Guard] Syntax check failed for ${absolutePath}`);
    }
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }

  return next();
}
