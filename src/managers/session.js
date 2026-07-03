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
          out += `\n**[Auto-extracted previous conversation record]** (from conversation "${convSummary.name}"):\n\`\`\`\n${convSummary.userMessages.join('\n')}\n\`\`\`\n`;
          out += `*(⚠️ Hint: This is a new session, please judge task continuity based on above history)*\n`;
        }
      }

      // Task rules detection
      try {
        const rulesDir = path.join(os.homedir(), '.lmstudio', 'tasks');
        if (fs.existsSync(rulesDir)) {
          const availableTasks = fs.readdirSync(rulesDir)
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
          
          if (availableTasks.length > 0) {
            out += `\n### 📚 Available Task Rules\n`;
            out += `System detected: [ ${availableTasks.join(", ")} ]\n`;
            out += `→ Please call load_task_rules(task="...") for corresponding rules.\n\n`;
          }
        }
      } catch (e) {}

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