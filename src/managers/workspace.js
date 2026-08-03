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

  // Legacy/global workspace. Prefer the in-memory value, but fall back to the persisted
  // globalLast so a new session (or server restart) can resume the previous workspace.
  getWorkspace() {
    if (this.currentWorkspace) return this.currentWorkspace;
    try {
      const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));
      if (state.globalLast && fs.existsSync(state.globalLast)) return state.globalLast;
    } catch (e) {}
    return null;
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

  // Session-specific workspace methods
  setSessionWorkspace(sessionId, workspacePath) {
    const resolvedPath = path.resolve(workspacePath);
    if (!fs.existsSync(resolvedPath)) throw new Error(`路径不存在: ${resolvedPath}`);
    if (!fs.statSync(resolvedPath).isDirectory()) throw new Error(`不是目录: ${resolvedPath}`);
    
    // Persist to state file
    this.ensureStateFile();
    const state = this._loadState();
    
    if (!state.sessions) state.sessions = {};
    state.sessions[sessionId] = {
      workspace: resolvedPath,
      lastUsed: new Date().toISOString()
    };
    
    // Also update global last
    state.globalLast = resolvedPath;
    
    fs.writeFileSync(STATE_DB, JSON.stringify(state, null, 2), 'utf8');
    
    return resolvedPath;
  }

  getWorkspaceForSession(sessionId) {
    this.ensureStateFile();

    try {
      const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));
      if (state.sessions && state.sessions[sessionId]) {
        return state.sessions[sessionId].workspace;
      }
    } catch (e) {
      return null;
    }

    return null;
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_DB)) {
        return JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));
      }
    } catch (e) {
      console.error(`[WorkspaceManager] Failed to load state: ${e.message}`);
    }
    return { sessions: {} };
  }

  _saveState(state) {
    fs.writeFileSync(STATE_DB, JSON.stringify(state, null, 2), 'utf8');
  }

  // Clear session-specific workspace
  clearSessionWorkspace(sessionId) {
    this.ensureStateFile();
    const state = this._loadState();
    
    if (state.sessions && state.sessions[sessionId]) {
      delete state.sessions[sessionId];
    }
    
    this._saveState(state);
  }
}

export const workspaceManager = new WorkspaceManager();
