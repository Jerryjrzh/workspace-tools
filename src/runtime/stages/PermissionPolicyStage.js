export async function PermissionPolicyStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !['file_patch', 'file_write'].includes(toolName)) {
    return next();
  }

  const permission = req.args?.permission || req.args?.mode || 'allow';
  if (permission === 'deny') {
    throw new Error('[Guard] Permission denied for write request');
  }

  return next();
}
