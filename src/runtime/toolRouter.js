import { toolHandlers } from '../tools/index.js';
import { normalizeToolResult } from './ToolResult.js';

export function getToolHandler(toolName) {
  return toolHandlers[toolName] || null;
}

/**
 * Execute a tool and return its raw handler output.
 *
 * NOTE: For backward compatibility with the Dispatcher (which returns ctx.result
 * directly to callers), executeTool preserves legacy string/JSON/MCP outputs as-is.
 * Use normalizeResult() when you need the canonical ToolResult contract shape —
 * e.g. at Streaming / UI boundaries where a uniform type is required.
 */
export async function executeTool(toolName, args, context) {
  const handler = getToolHandler(toolName);
  if (!handler) {
    throw new Error(`Tool not found: ${toolName}`);
  }
  return handler(toolName, args, context);
}

/**
 * Normalize a tool's raw output into the canonical ToolResult contract.
 * Handlers that already return structured results pass through unchanged.
 */
export function normalizeResult(raw, opts = {}) {
  return normalizeToolResult(raw, opts);
}

export default { getToolHandler, executeTool, normalizeResult };
