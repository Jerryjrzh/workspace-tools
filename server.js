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
import { dispatch as runtimeDispatch } from "./src/dispatcher.js";
import {
  ALL_TOOLS,
  toolHandlers,
  listEnabledTools,
  isToolEnabled
} from "./src/tools/index.js";

// Server options: tools.groups 控制注入的工具组（默认仅 core）。
//   - core: workspace/file/search/git/context/memory/embedding/review/task
//   - ops : shell process / tmux / ssh-serial / env （运维扩展，按需启用）
// 也可用环境变量 WORKSPACE_TOOLS_GROUPS=core,ops 覆盖。
const _envGroups = (process.env.WORKSPACE_TOOLS_GROUPS || '').split(',').filter(Boolean);
const SERVER_OPTIONS = {
  tools: { groups: _envGroups }
};

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
      const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      // Normalize `sessions` to an array. context_anchor writes it as an object
      // keyed by sessionId; legacy code expects the array format [{ date, summary }].
      if (!parsed || typeof parsed !== 'object') {
        return { sessions: [] };
      }
      let sessions = parsed.sessions;
      if (Array.isArray(sessions)) {
        return { ...parsed, sessions };
      }
      if (sessions && typeof sessions === 'object') {
        const archiveEntries = Object.values(sessions).filter(
          (e) => e && typeof e === 'object' && ('date' in e || 'summary' in e)
        );
        return { ...parsed, sessions: archiveEntries };
      }
      return { ...parsed, sessions: [] };
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
function isPredictFetchFailure(err) {
  const message = String(err?.message || err || '');
  return /predict request failed|Failed to send message|fetch failed|networkerror|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

async function handleTool(name, args, extra = {}) {
  const convId = extra?.conversation_id || 'default';
  // Only network/predict-fetch failures are retryable; other errors must not be silently retried.
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await runtimeDispatch({ name, args: args || {}, conversationId: convId });
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < 2 && isPredictFetchFailure(err)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      break;
    }
  }

  const message = String(lastError?.message || lastError || 'Unknown error');
  if (isPredictFetchFailure(lastError)) {
    return {
      content: [{
        type: 'text',
        text: `⚠️ 预测请求失败：${message}\n\n已触发降级策略：\n- 自动重试 1 次\n- 若仍失败，请缩短 system prompt / 关闭超长上下文 / 检查本地引擎可用性\n- 可切换到轻量 Bootstrap 模式继续运行`
      }],
      isError: true,
      errorType: 'predict_fetch_failed',
      retryable: true
    };
  }

  throw lastError;
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

// ListTools 按启用组返回：默认仅 core（开发常用），ops(运维)工具不注入，
// 直到显式启用 WORKSPACE_TOOLS_GROUPS=core,ops。
server.setRequestHandler(ListToolsRequestSchema, async () => listEnabledTools(SERVER_OPTIONS));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  // ── Tool Group Guard ─────────────────────────────────────────────
  // 未启用组的工具不执行，返回明确提示（而非 "Tool not found"）。
  const toolCheck = isToolEnabled(name, SERVER_OPTIONS);
  if (!toolCheck.enabled) {
    return {
      content: [{
        type: 'text',
        text: `🔒 工具 "${name}" 属于运维扩展组(ops)，当前未启用。\n\n` +
              `默认仅注入 core 组（workspace/file/search/git/context/memory/\n` +
              `embedding/review/task）。如需启用运维工具，请设置环境变量：\n` +
              `WORKSPACE_TOOLS_GROUPS=core,ops  或 server options tools.groups=['core','ops']。`
      }],
      isError: true
    };
  }

  try {
    const result = await handleTool(name, args || {}, extra);
    if (result && typeof result === 'object') {
      const structuredContent = structuredClone(result);
      const textBlocks = [];
      if (typeof structuredContent.content === 'string') {
        textBlocks.push(structuredContent.content);
        structuredContent.content_in_text_block = true;
        delete structuredContent.content;
      }
      if (typeof structuredContent.nearestMatch?.content === 'string') {
        textBlocks.push(structuredContent.nearestMatch.content);
        structuredContent.nearestMatch.content_in_text_block = true;
        delete structuredContent.nearestMatch.content;
      }

      // Metadata must be visible in the ordinary text channel because some MCP clients
      // discard structuredContent. Source excerpts use separate blocks and stay single-encoded.
      const content = [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }];
      content.push(...textBlocks.map((text) => ({ type: 'text', text })));
      // LM Studio's legacy tools bridge accepts the core MCP content/isError shape only.
      // Returning structuredContent without an advertised output schema can terminate the
      // provider connection instead of reporting a validation error.
      return { content, isError: result.ok === false };
    }
    return { content: [{ type: 'text', text: String(result) }] };
  } catch (err) {
    // In a real implementation, we would log the error here
    return { content: [{ type: "text", text: `❌ ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Log that server has started
console.error(`🚀 LM Studio Workspace Tools MCP Server v2.1.0 已启动`);
console.error(`📁 Runtime Pipeline 已启用（Dispatcher → Stages → Tool）`);
console.error(`🔄 Bootstrap 工具直通，Business 工具经完整 stage pipeline`);
console.error(`✅ dispatcher.dispatch() 为唯一请求入口`);
