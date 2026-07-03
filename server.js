#!/usr/bin/env node
/**
 * LM Studio Workspace Tools MCP Server v2.0.0
 * - 模块化架构：基于 Gemini 升级方案实现
 * - 工作区仅在当前会话内有效，不跨会话持久化
 * - 增强文本操作：patch、append、transform、diff
 * - 新增：find_files、workspace_tree、env_info、port_check、clipboard、json_query
 * v2.0.0 新特性：
 *   - 模块化工具架构，解耦核心逻辑
 *   - 会话级工作区隔离，彻底解决多会话串扰问题
 *   - 中间件安全防护，防止未授权写操作
 *   - 按需加载上下文，减少首次启动开销
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { workspaceManager } from "./src/managers/workspace.js";
import { handleSessionStart } from "./src/managers/session.js";
import { ruleManager } from "./src/managers/rules.js";
import { ALL_TOOLS, toolHandlers } from "./src/tools/index.js";

// Import additional tools that are still in server.js for now
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import https from "https";
import { execSync } from "child_process";

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_LOG_FILE = '.lmstudio-workspace.json';

/**
 * Load workspace log file
 */
function loadWorkspaceLog(ws) {
  try {
    const logPath = path.join(ws || process.cwd(), WORKSPACE_LOG_FILE);
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (e) {}
  return { sessions: [] };
}

/**
 * Save workspace log file
 */
function saveWorkspaceLog(log, ws) {
  const logPath = path.join(ws || process.cwd(), WORKSPACE_LOG_FILE);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Build workspace summary for display
 */
function buildWorkspaceSummary(workspacePath) {
  return `✅ 工作区已设置: ${workspacePath}\n` +
         `💡 提示：此工作区仅在当前会话内有效，切换会话后不会受到其他会话的影响\n` +
         `🔧 如需清除当前会话工作区设置，使用 workspace_clear`;
}

/**
 * Extract conversation summaries from a workspace
 */
function extractConversationSummaries(ws, maxCount = 5) {
  try {
    const convDir = path.join(os.homedir(), '.lmstudio', 'conversations');
    if (!fs.existsSync(convDir)) return [];
    
    const files = fs.readdirSync(convDir)
      .filter(f => f.endsWith('.conversation.json'))
      .map(f => ({ 
        name: f, 
        mtime: fs.statSync(path.join(convDir, f)).mtimeMs 
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxCount);
    
    return files.map(file => {
      try {
        const convData = JSON.parse(fs.readFileSync(path.join(convDir, file.name), 'utf8'));
        const messages = convData.messages || [];
        const userMessages = messages
          .filter(msg => msg.role === 'user')
          .map(msg => msg.content?.text || '')
          .filter(Boolean);
          
        return {
          name: file.name.replace('.conversation.json', ''),
          model: convData.model || 'Unknown',
          messageCount: messages.length,
          userMessages: userMessages.slice(0, 3) // Limit to first 3 for display
        };
      } catch (e) {
        return {
          name: file.name.replace('.conversation.json', ''),
          model: 'Error',
          messageCount: 0,
          userMessages: [`无法读取对话内容: ${e.message}`]
        };
      }
    });
  } catch (e) {
    return [];
  }
}

/**
 * Handle tool requests using modular approach
 */
async function handleTool(name, args, extra = {}) {
  // Extract conversation ID from extra parameter
  const convId = extra?.conversation_id || "default";
  
  // Check if we have a handler for this tool
  if (toolHandlers[name]) {
    return await toolHandlers[name](name, args, convId);
  }
  
  // Handle tools that are still implemented in server.js for backward compatibility
  // Handle tools that are still implemented in server.js for backward compatibility
  switch (name) {
    // These should ideally be handled by toolHandlers, but keeping as fallback
    default:
      throw new Error(`未知工具: ${name}`);
  }}

// Helper function to get workspace (backward compatibility)
function getWorkspace() {
  return workspaceManager.getWorkspace();
}

/**
 * MCP Server ────────────────────────────────────────────────────────────────
 */
const server = new Server(
  { name: "workspace-tools", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {}, extra);
    // In a real implementation, we would log the operation here
    return { content: [{ type: "text", text: String(result) }] };
  } catch (err) {
    // In a real implementation, we would log the error here
    return { content: [{ type: "text", text: `❌ ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Log that server has started
console.error(`🚀 LM Studio Workspace Tools MCP Server v2.0.0 已启动`);
console.error(`📁 工作区隔离架构已启用，彻底解决多会话串扰问题`);