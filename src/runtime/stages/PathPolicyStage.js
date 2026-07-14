import path from 'path';

export async function PathPolicyStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !['file_patch', 'file_write', 'file_read'].includes(toolName)) {
    return next();
  }

  const targetPath = req.args?.path;
  if (!targetPath) {
    throw new Error(`[Guard] Tool ${toolName} missing required argument: path`);
  }

  const absolutePath = path.resolve(ctx.workspace, targetPath);
  if (!absolutePath.startsWith(ctx.workspace)) {
    throw new Error(`[Guard] 越权访问拒绝: 试图访问 workspace 外部的路径 (${absolutePath})`);
  }

  ctx.state = ctx.state || {};
  ctx.state.absolutePath = absolutePath;
  return next();
}
