// src/runtime/ToolResult.js
/**
 * ToolResult - Unified return contract for all tools.
 *
 * Per docs/CONTEXT_CONTRACT.md §4, every tool must return a structured object,
 * never raw string / JSON / MCP Content mixed. Executor layers converge on this
 * shape so downstream consumers (Dispatcher, Streaming, UI) can rely on it.
 */

export const TOOL_RESULT_TYPES = ['string', 'json', 'mcp_content'];

/**
 * Wrap any tool output into the canonical ToolResult shape.
 *
 * @param {*} data - raw result from a tool handler
 * @param {Object} [opts]
 * @returns {{ok:boolean,data:*,type:string,meta:object}}
 */
export function toToolResult(data, opts = {}) {
  const type = inferType(data);
  return {
    ok: true,
    data,
    type,
    meta: {
      tool: opts.tool || null,
      durationMs: opts.durationMs ?? null
    }
  };
}

/**
 * Infer the result type from raw data.
 */
export function inferType(data) {
  if (data && typeof data === 'object' && Array.isArray(data.content)) {
    return 'mcp_content';
  }
  if (typeof data === 'string') {
    return 'string';
  }
  // objects / arrays / numbers → json
  return 'json';
}

/**
 * Normalize a handler's raw return into ToolResult. If the handler already
 * returned a ToolResult-shaped object, pass it through unchanged.
 */
export function normalizeToolResult(raw, opts = {}) {
  if (raw && typeof raw === 'object' && raw.ok === true &&
      Object.prototype.hasOwnProperty.call(raw, 'data') &&
      TOOL_RESULT_TYPES.includes(raw.type)) {
    return raw;
  }
  return toToolResult(raw, opts);
}

const ToolResult = { toToolResult, normalizeToolResult, inferType };
export default ToolResult;
