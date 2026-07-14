// src/tools/workspace.js
import { workspaceManager } from '../managers/workspace.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync as execSyncChild } from 'child_process';

export const workspaceTools = [
  {
    name: "workspace_set",
    description: "设置当前会话的工作目录。path=\"last\" 或 path=\"auto\" 可自动恢复上次使用的目录，无需记忆路径",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "目录绝对路径，或 \"last\"/\"auto\" 自动恢复上次使用的目录"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "workspace_clear",
    description: "清除当前会话的 workspace 设置，恢复为进程 cwd",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "workspace_info",
    description: "显示当前会话工作区路径及最近使用历史",
    inputSchema: {
      type: "object",
      properties: {
        subpath: { type: "string" },
        all: { type: "boolean", description: "显示隐藏文件" }
      }
    }
  }
];

export async function handleWorkspaceTools(name, args, convId) {
  switch (name) {
    case 'workspace_set':
      // Directly call underlying manager for processing
      return workspaceManager.setSessionWorkspace(convId || 'default', args.path);
     
    case 'workspace_clear': {
      // Clear workspace - set to null/global fallback
      try {
        const statePath = path.join(os.homedir(), '.lmstudio', '.internal', 'mcp_runtime_state.json');
        if (fs.existsSync(statePath)) {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          if (convId && state.sessions[convId]) {
            delete state.sessions[convId];
          }
          // Also clear global last
          state.globalLast = null;
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
        }
      } catch (error) {
        // If we can't update the state file, continue with clearing anyway
      }
      return `✅ 已清除 workspace 设置，当前使用进程 cwd: ${process.cwd()}`;
    }
    
    case 'workspace_info': {
      const ws = workspaceManager.getWorkspaceForSession(convId);
      const isSet = ws !== null && ws !== process.cwd();
      let info = `当前 Workspace: ${ws} ${isSet ? "(本会话已设置)" : "(⚠️  未设置，当前为进程 cwd，文件操作可能受限)"}\n`;
      
      try {
        const sizeOutput = await execSync(`du -sh . 2>/dev/null | cut -f1`, { encoding: 'utf8', cwd: ws });
        info += `目录大小: ${sizeOutput.trim()}\n`;
      } catch {}
      
      info += `\n最近使用历史:\n`;
      // Get history from state file
      try {
        const statePath = path.join(os.homedir(), '.lmstudio', '.internal', 'mcp_runtime_state.json');
        if (fs.existsSync(statePath)) {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          const globalLast = state.globalLast;
          if (globalLast) {
            info += `  1. ${globalLast}${globalLast === ws ? " ← 当前" : ""}\n`;
          }
          
          // Add session-specific history if available
          if (convId && state.sessions[convId]) {
            const sessionWs = state.sessions[convId].workspace;
            info += `  2. ${sessionWs}${sessionWs === ws ? " ← 当前（本会话）" : ""}\n`;
          }
        }
      } catch {}
      
      return info;
    }
    
    default:
      throw new Error(`未知 workspace 工具: ${name}`);
  }
}

// Helper function for running commands (simplified)
function execSync(command, options) {
  return execSyncChild(command, options);
}