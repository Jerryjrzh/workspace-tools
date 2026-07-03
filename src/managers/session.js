// src/managers/session.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { workspaceManager } from './workspace.js';
import { conversationManager } from './conversation.js';

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

    // 4. Execute split strategy (avoid scanning slowdown in deep context)
    let report = `## 🚀 Session Start Alignment Report [Architecture v3]\n`;
    report += `**Current Session ID**: \`${convId}\`\n`;
    report += `**Environment Workspace**: \`${currentWs}\`\n\n`;

    if (mode === 'fast') {
      report += `⚡ Fast ready mode enabled, environment path calibrated. For deep analysis, specify deep mode.\n`;
      return report;
    }

    // Deep mode: perform original server.js deep text extraction and log retrieval
    try {
      const wsLog = loadWorkspaceLog(currentWs);
      const lastWsSession = wsLog.sessions?.slice(-1)[0];

      let out = `## 🚀 Session Start Status Report\n\n`;
      out += `**Workspace**: ${currentWs || "⚠️ 未设置"}\n\n`;

      // Extract conversation snippet similar to original
      const convSummary = conversationManager.extractConversationSummary(convData);
      
      out += `### 📝 Task Progress Summary\n`;
      if (lastWsSession) {
        out += `**[Archived Summary]** (Archive time: ${lastWsSession.date})\n`;
        out += `> ${lastWsSession.summary}\n`;
        if (lastWsSession.context) out += `> Context: ${lastWsSession.context}\n`;

        // Check if there are newer conversations
        const files = fs.readdirSync(path.join(os.homedir(), '.lmstudio', 'conversations'))
          .filter(f => f.endsWith('.conversation.json'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(os.homedir(), '.lmstudio', 'conversations', f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0 && files[0].mtime > new Date(lastWsSession.date).getTime()) {
          out += `\n**[Unarchived Latest Clues]** (occurred after archive in conversation "${convSummary.name}")\n\`\`\`\n${convSummary.userMessages.join('\n')}\n\`\`\`\n`;
          out += `*(⚠️ Hint: Detected operations after last summary, please combine above clues to judge task continuity)*\n`;
        }
      } else {
        out += `*No manually archived summary.*\n`;
        if (convSummary.userMessages.length > 0) {
      // Task rules detection and auto-loading
      let detectedTask = null;
      let taskRulesContent = "";
      
      try {
        const rulesDir = path.join(os.homedir(), '.lmstudio', 'tasks');
        if (fs.existsSync(rulesDir)) {
          // Analyze conversation to detect task type
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
          
          // Detect task type based on conversation content
          for (const [taskName, patterns] of Object.entries(taskPatterns)) {
            for (const pattern of patterns) {
              if (pattern.test(convTextLower)) {
                detectedTask = taskName;
                break;
              }
            }
            if (detectedTask) break;
          }
          
          // If detected, load and display the corresponding task rules
          if (detectedTask && fs.existsSync(path.join(rulesDir, `${detectedTask}.md`))) {
            try {
              taskRulesContent = ruleManager.loadTask(detectedTask);
              
              out += `\\n### 🤖 Auto-Detected Task Rules\\n`;
              out += `Based on conversation analysis, detected task type: **${detectedTask}**\\n\\n`;
              out += `<details><summary>View ${detectedTask} task rules (click to expand)</summary>\\n\\n`;
              out += `${taskRulesContent}\\n\\n</details>\\n\\n`;
              
              out += `💡 Tip: You can also manually load rules using: load_task_rules(task="${detectedTask}")\\n\\n`;
            } catch (e) {
              console.warn(`Failed to load task rules for ${detectedTask}:`, e.message);
              out += `\\n⚠️ Failed to load auto-detected ${detectedTask} task rules: ${e.message}\\n\\n`;
            }
          } else {
            // Fallback to showing available tasks if no specific task detected
            const availableTasks = fs.readdirSync(rulesDir)
              .filter(f => f.endsWith('.md'))
              .map(f => f.replace('.md', ''));
            
            if (availableTasks.length > 0) {
              out += `\\n### 📚 Available Task Rules\\n`;
              out += `System detected: [ ${availableTasks.join(\", \")} ]\\n`;
              out += `→ Please call load_task_rules(task=\"...\") for corresponding rules.\\n\\n`;
            }
          }
        }
      } catch (e) {
        // Silently continue if task rules detection fails
        console.warn('Task rules detection failed:', e.message);
        out += `\\n⚠️ Task rules detection encountered an error: ${e.message}\\n\\n`;
      }
      // PROGRESS status
      if (args.include_progress !== false && currentWs) {
        try {
          const pf = path.join(currentWs, "PROGRESS.md");
          if (fs.existsSync(pf)) {
            const content = fs.readFileSync(pf, "utf8");
            const lines = content.split("\n");
            const done = lines.filter(l => l.includes("✅")).length;
            const pending = lines.filter(l => l.includes("⏳")).length;
            const total = done + pending + lines.filter(l => l.includes("🔄")).length;
            const nextTasks = lines.filter(l => l.includes("⏳")).map(l => l.replace(/\|/g, "").trim()).slice(0, 3);
            
            out += `\n### 📊 Project Progress (PROGRESS.md)\n`;
            out += `Completed: ${done}/${total} (${Math.round(done/total*100)}%)\n`;
            if (nextTasks.length > 0) out += `Next steps:\n${nextTasks.map(t => `  • ${t}`).join("\n")}\n`;
            out += `\n`;
          }
        } catch {}
      }

      return out;
    } catch (error) {
      // Fallback to basic report if deep mode fails
      return `## 🚀 Session Start Alignment Report [Architecture v3]\n` +
             `**Current Session ID**: \`${convId}\`\n` +
             `**Environment Workspace**: \`${currentWs}\`\n\n` +
             `⚡ Fast ready mode enabled, environment path calibrated.\n`;
    }
  } catch (error) {
    throw new Error(`Session start failed: ${error.message}`);
  }
}

// Helper function to load workspace log (simplified version)
function loadWorkspaceLog(ws) {
  try {
    const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (e) {}
  return { sessions: [] };
}