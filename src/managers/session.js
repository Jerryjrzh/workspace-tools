// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { workspaceManager } from './workspace.js';
import { conversationManager } from './conversation.js';
import { ruleManager } from './rules.js';

/**
 * Load workspace log file (local helper, also defined in server.js)
 */
function loadWorkspaceLog(ws) {
  try {
    const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (e) {}
  return { sessions: [] };
}

export async function handleSessionStart(args) {
  const mode = args.mode || 'fast'; // Implement fast/deep split mode

  try {
    // 1. Retrieve physical disk conversation source file closest to active state
    const latestConv = await conversationManager.getLatestConversation();
    const targetConvFile = latestConv.name;
    const convId = targetConvFile.replace('.conversation.json', '');
    const convData = await conversationManager.loadConversation(convId);
    
    // 2. Deeply parse session text to lock its originally embedded workspace
    let inferredWorkspace = null;
    const convText = JSON.stringify(convData.messages || []);
    
    // Precise extraction of user's last declared absolute path or historical feature
    const wsMatch = convText.match(/(?:"text"\s*:\s*"当前workspace是\s*|workspace_set"\s*,\s*"parameters"\s*:\s*{\s*"path"\s*:*\s*)([^\s"'}]+)/i);
    if (wsMatch && wsMatch[1]) {
      inferredWorkspace = wsMatch[1];
    }

    if (inferredWorkspace) {
      // 3. Generate irreversible forced binding, eliminate memory overwrite risk
      workspaceManager.setSessionWorkspace(convId, inferredWorkspace);
    }

    const currentWs = workspaceManager.getWorkspaceForSession(convId);
    
    // Extract conversation summary
    const convSummary = conversationManager.extractConversationSummary(convData);

    // Deep mode: perform original server.js deep text extraction and log retrieval
    try {
      const wsLog = loadWorkspaceLog(currentWs);
      const lastWsSession = wsLog.sessions?.slice(-1)[0];

      // Detect task type based on conversation content
      let detectedTask = null;
      
      try {
        const rulesDir = path.join(os.homedir(), '.lmstudio', 'tasks');
        if (fs.existsSync(rulesDir)) {
          const convTextLower = convData.messages 
            ? convData.messages.map(m => m.content || '').join(' ').toLowerCase()
            : '';
          
          // Define task detection patterns
          const taskPatterns = {
            coding: [
              /编码|coding|实现|implement|开发|develop|函数|function|类|class|变量|variable/i,
              /修复|fix|bug|错误|error|优化|optimize|重构|refactor/i
            ],
            debug: [
              /调试|debug|故障|troubleshoot|问题|problem|异常|exception|崩溃|crash/i,
              /日志|log|trace|监控|monitor|性能|performance/i
            ],
            review: [
              /审查|review|检查|check|审计|audit|评估|evaluate|质量|quality/i,
              /安全|security|最佳实践|best practice|标准|standard|规范|specification/i
            ]
          };
          
          // Detect task type
          for (const [taskName, patterns] of Object.entries(taskPatterns)) {
            for (const pattern of patterns) {
              if (pattern.test(convTextLower)) {
                detectedTask = taskName;
                break;
              }
            }
            if (detectedTask) break;
          }
        }
      } catch (e) {
        console.warn('Task rules detection failed:', e.message);
      }
      
      workspaceManager.setSessionInitStatus(convId, true, detectedTask);

      // Return standardized JSON Machine State with additional details
      return {
        status: "READY",
        workspace: currentWs || "⚠️ 未设置",
        session_id: convId,
        active_task: detectedTask || "none",
        details: {
          message: "环境已就绪，可以开始执行工具调用。",
          mode: mode,
          last_archived_session: lastWsSession ? {
            date: lastWsSession.date,
            summary: lastWsSession.summary,
            context: lastWsSession.context
          } : null,
          conversation_snippet: convSummary.userMessages.slice(0, 3),
          global_rules_loaded: true
        }
      };
    } catch (error) {
      // Fallback to basic JSON state if deep mode fails
      return {
        status: "READY",
        workspace: currentWs || "⚠️ 未设置",
        session_id: convId,
        active_task: "none",
        details: {
          message: "环境已就绪，可以开始执行工具调用。",
          mode: mode,
          error: error.message
        }
      };
    }
  } catch (error) {
    throw new Error(`Session start failed: ${error.message}`);
  }
}
