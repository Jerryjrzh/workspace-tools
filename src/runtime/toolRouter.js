import { getToolHandler as lazyGetToolHandler } from '../tools/registry.js';
import { normalizeToolResult } from './ToolResult.js';

/**
 * Resolve a tool's handler, lazily loading its module on first use.
 *
 * Missing/unloaded tools are auto-routed to their owning module via the
 * static TOOL_TO_MODULE table and dynamically imported (then cached).
 */
export async function getToolHandler(toolName) {
  return lazyGetToolHandler(toolName);
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
  const handler = await getToolHandler(toolName);
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
