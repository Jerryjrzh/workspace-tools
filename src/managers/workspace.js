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
      // Removed globalLast initialization - no longer needed
      fs.writeFileSync(STATE_DB, JSON.stringify({ sessions: {} }), 'utf8');
    }
  }

  // Core: bind specific session and workspace path
  setSessionWorkspace(convId, workspacePath) {
    this.ensureStateFile();
    const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));

    const resolvedPath = path.resolve(workspacePath);
    if (!fs.existsSync(resolvedPath)) throw new Error(`路径不存在: ${resolvedPath}`);
    if (!fs.statSync(resolvedPath).isDirectory()) throw new Error(`不是目录: ${resolvedPath}`);

    // Initialize session entry if not exists
    if (!state.sessions[convId]) {
      state.sessions[convId] = {
        updatedAt: new Date().toISOString()
      };
    }

    state.sessions[convId].workspace = resolvedPath;
    state.sessions[convId].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(STATE_DB, JSON.stringify(state, null, 2), 'utf8');
    return resolvedPath;
  }

  // Set initialization status and detected task for a session
  setSessionInitStatus(convId, initialized, task = null) {
    this.ensureStateFile();
    const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));

    if (!state.sessions[convId]) {
      state.sessions[convId] = {};
    }

    state.sessions[convId].initialized = initialized;
    state.sessions[convId].task = task;
    state.sessions[convId].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(STATE_DB, JSON.stringify(state, null, 2), 'utf8');
  }

  // Get workspace that definitely belongs to current context
  getWorkspaceForSession(convId) {
    this.ensureStateFile();
    const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));

    if (convId && state.sessions[convId]) {
      return state.sessions[convId].workspace;
    }
    // Removed fallback to global last active path - now requires explicit session context
    // Return undefined or throw error to force explicit workspace setting
    return undefined; 
  }

  // Get initialization status for a session
  getSessionInitStatus(convId) {
    this.ensureStateFile();
    const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));
    const session = state.sessions[convId];
    if (!session) {
      return { initialized: false };
    }
    return {
      initialized: !!session.initialized,
      task: session.task || null
    };
  }

  // Legacy compatibility - get workspace without session context
  getWorkspace() {
    // Now requires explicit session context, returns undefined if none
    return this.getWorkspaceForSession(null);
  }

  // Set workspace globally (for backward compatibility)
  setWorkspace(dirPath) {
    // For now, we'll use a default conversation ID for global operations
    // In practice, this should come from the actual conversation context
    const defaultConvId = 'global';
    return this.setSessionWorkspace(defaultConvId, dirPath);
  }
}

export const workspaceManager = new WorkspaceManager();