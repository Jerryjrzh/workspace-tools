export async function WorkspacePolicyStage(ctx, next) {
  const req = ctx.toolRequest || {};
  const toolName = req.name;

  if (!toolName || !['file_patch', 'file_write', 'file_read'].includes(toolName)) {
    return next();
  }

  if (!ctx.workspace) {
    throw new Error('[Guard] Workspace not set before file tool execution');
  }

  return next();
}
