// src/managers/workspace.js
import fs from 'fs';
import path from 'path';
import os from 'os';

const STATE_DB = path.join(os.homedir(), '.lmstudio', '.internal', 'mcp_runtime_state.json');

class WorkspaceManager {
  constructor() {
    this.ensureStateFile();
  }

  ensureStateFile() {
    const dir = path.dirname(STATE_DB);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(STATE_DB)) {
      fs.writeFileSync(STATE_DB, JSON.stringify({}), 'utf8');
    }
  }

  // Single Source of Truth: currentWorkspace for legacy compatibility only
  // Session workspace is now stored in SessionContext
  getWorkspace() {
    return this.currentWorkspace || null;
  }

  // Set current workspace for legacy compatibility (not session-specific)
  setWorkspace(dirPath) {
    const resolvedPath = path.resolve(dirPath);
    if (!fs.existsSync(resolvedPath)) throw new Error(`路径不存在: ${resolvedPath}`);
    if (!fs.statSync(resolvedPath).isDirectory()) throw new Error(`不是目录: ${resolvedPath}`);
    this.currentWorkspace = resolvedPath;
    return resolvedPath;
  }

  // Clear current workspace (legacy compatibility)
  clearWorkspace() {
    this.currentWorkspace = null;
  }
}

export const workspaceManager = new WorkspaceManager();