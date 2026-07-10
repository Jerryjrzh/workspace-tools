#!/usr/bin/env node
/**
 * LM Studio Workspace Tools MCP Server v2.1.0
 * - 三层架构：Bootstrap/Context Ready/Business Tool
 * - 分离启动流程：解决 session_start 与 workspace_set 互锁问题
 * - 工作区仅在当前会话内有效，不跨会话持久化
 * - 增强文本操作：patch、append、transform、diff
 * - 新增：find_files、workspace_tree、env_info、port_check、clipboard、json_query
 * v2.1.0 新特性：
 *   - 三层架构实现（Bootstrap/Context Ready/Business Tool）
 *   - 启动流程分离（无循环依赖）
 *   - SessionMiddleware 分层调用
 *   - Single Source of Truth：SessionContext 是唯一可信源
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { workspaceManager } from "./src/managers/workspace.js";
import { handleSessionStart } from "./src/managers/session.js";
import { ruleManager } from "./src/managers/rules.js";
import { SessionMiddleware } from "./src/middleware/sessionMiddleware.js";
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
 * Handle tool requests using modular approach with layered middleware
 * 
 * NEW: Uses SessionMiddleware dispatch with 3-layer architecture
 * - Bootstrap Phase: workspace_set, session_start, workspace_info
 * - Context Ready Phase: SessionContext已就绪
 * - Business Phase: file_read, file_patch, shell_run, etc.
 * 
 * Session ID Flow:
 * LM Studio → conversation_id → SessionMiddleware → Context → Tool
 */
async function handleTool(name, args, extra = {}) {
  // Extract conversation ID from extra parameter
  const convId = extra?.conversation_id || "default";
  
  // Use SessionMiddleware dispatch to handle layered architecture
  const result = await SessionMiddleware.dispatch(name, args, convId);
  
  // If result contains context and toolArgs, we need to call the tool handler
  if (result && result.context && result.toolArgs) {
    // Get tool handler
    if (toolHandlers[name]) {
      return await toolHandlers[name](name, result.toolArgs, result.context);
    }
  }
  
  // For bootstrap tools, return the result directly
  return result;
}

// Helper function to get workspace (backward compatibility)
function getWorkspace() {
  return workspaceManager.getWorkspace();
}

/**
 * MCP Server ────────────────────────────────────────────────────────────────
 */
const server = new Server(
  { name: "workspace-tools", version: "1.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {}, extra);
    // 必须增加类型判断，强制标准化
    const standardizedText = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    
    return { content: [{ type: "text", text: standardizedText }] };
  } catch (err) {
    // In a real implementation, we would log the error here
    return { content: [{ type: "text", text: `❌ ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Log that server has started
console.error(`🚀 LM Studio Workspace Tools MCP Server v2.1.0 已启动`);
console.error(`📁 三层架构已启用（Bootstrap/Context Ready/Business Tool）`);
console.error(`🔄 分层调用已启用，解决 session_start/workspace_set 互锁问题`);
console.error(`✅ SessionMiddleware 已实现单向状态流`);
