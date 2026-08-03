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

  // An absolute path is resolved as-is; a relative path is resolved against the workspace.
  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : (ctx.workspace ? path.resolve(ctx.workspace, targetPath) : path.resolve(process.cwd(), targetPath));

  ctx.state = ctx.state || {};
  ctx.state.absolutePath = absolutePath;

  // Write operations must stay inside the workspace to prevent accidental damage.
  if ((toolName === 'file_patch' || toolName === 'file_write') && ctx.workspace) {
    const wsRoot = path.resolve(ctx.workspace);
    if (!path.dirname(absolutePath).startsWith(wsRoot)) {
      throw new Error(`[Guard] 越权访问拒绝: 试图写入 workspace 外部的路径 (${absolutePath})`);
    }
  }

  // file_read is read-only and may access any explicit path (system files, checkpoints,
  // configs outside the workspace). No write risk.
  return next();
}
