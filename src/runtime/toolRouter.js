import { toolHandlers } from '../tools/index.js';

export function getToolHandler(toolName) {
  return toolHandlers[toolName] || null;
}

export async function executeTool(toolName, args, context) {
  const handler = getToolHandler(toolName);
  if (!handler) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  return handler(toolName, args, context);
}

export default { getToolHandler, executeTool };
