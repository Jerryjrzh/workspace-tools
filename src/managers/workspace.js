// src/managers/workspace.js
import fs from 'fs';
import path from 'path';
import os from 'os';

const STATE_DB = path.join(os.homedir(), '.lmstudio', '.internal', 'mcp_runtime_state.json');
const MAX_HISTORY_ENTRIES = 20;

/**
 * Workspace Compass (罗盘)
 *
 * A structured, time-ordered history of workspaces persisted in the state DB.
 * New sessions that have not explicitly set a workspace can "read the compass"
 * and resume the most recent valid workspace automatically.
 *
 * History entries are filtered for trustworthiness:
 *   - MCP installation directories are never accepted as real workspaces
 *   - transient test paths (/tmp/runtime-*) are excluded from auto-resume
 */
class WorkspaceManager {
  constructor() {
    this.ensureStateFile();
    // Seed the compass from legacy per-session entries on first load.
    this._seedCompassFromSessions();
  }

  /**
   * One-time migration: build workspaceHistory from existing sessions[].workspace
   * so a fresh server can resume prior workspaces even before any new set happens.
   */
  _seedCompassFromSessions() {
    const state = this._loadState();
    if (Array.isArray(state.workspaceHistory) && state.workspaceHistory.length > 0) {
      return; // already seeded
    }

    const sessions = state.sessions || {};
    const now = new Date().toISOString();
    let history = [];

    for (const entry of Object.values(sessions)) {
      if (!entry || typeof entry.workspace !== 'string') continue;
      const ws = path.resolve(entry.workspace);
      if (!this._isTrustworthyWorkspace(ws)) continue;

      // Dedup by path, keep the most recent lastUsed
      const existingIdx = history.findIndex((h) => h.path === ws);
      const entryTime = entry.lastUsed || now;
      if (existingIdx >= 0) {
        if ((entryTime || '').localeCompare(history[existingIdx].lastUsed || '') > 0) {
          history[existingIdx].lastUsed = entryTime;
        }
      } else {
        history.push({ path: ws, lastUsed: entryTime, source: 'legacy-session' });
      }
    }

    // Sort newest-first and cap
    history.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    state.workspaceHistory = history;
    this._saveState(state);
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

  // ── Compass helpers ────────────────────────────────────────────────

  /** A path is trustworthy as a real workspace (not MCP install dir / transient test). */
  _isTrustworthyWorkspace(ws) {
    if (!ws || typeof ws !== 'string') return false;
    if (/\.lmstudio\/extensions\/plugins\/mcp/i.test(ws)) return false; // never MCP install dir
    if (/^\/tmp\/runtime-/.test(ws)) return false;                       // transient test paths
    try {
      return fs.existsSync(ws) && fs.statSync(ws).isDirectory();
    } catch (e) {
      return false;
    }
  }

  /** Read the current compass history, sorted newest-first. */
  getWorkspaceHistory() {
    const state = this._loadState();
    const history = Array.isArray(state.workspaceHistory) ? state.workspaceHistory : [];
    // Normalize + filter invalid entries
    return history
      .filter((h) => h && typeof h.path === 'string')
      .map((h) => ({
        path: h.path,
        lastUsed: h.lastUsed || '',
        source: h.source || 'unknown'
      }))
      .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }

  /**
   * Read the compass and return the most recent trustworthy workspace.
   * Used by session_start when no explicit per-session workspace exists.
   */
  getCompassWorkspace() {
    const history = this.getWorkspaceHistory();
    for (const entry of history) {
      if (this._isTrustworthyWorkspace(entry.path)) return entry.path;
    }
    // Fall back to legacy globalLast
    try {
      const state = JSON.parse(fs.readFileSync(STATE_DB, 'utf8'));
      if (state.globalLast && this._isTrustworthyWorkspace(state.globalLast)) return state.globalLast;
    } catch (e) {}
    return null;
  }

  /** Record a workspace in the compass history (dedup + bump to top). */
  _recordCompass(workspacePath, source = 'explicit') {
    const resolvedPath = path.resolve(workspacePath);
    if (!this._isTrustworthyWorkspace(resolvedPath)) return;

    const state = this._loadState();
    let history = Array.isArray(state.workspaceHistory) ? state.workspaceHistory : [];

    // Remove any existing entry for the same path
    history = history.filter((h) => h.path !== resolvedPath);

    // Add to front (newest)
    history.unshift({
      path: resolvedPath,
      lastUsed: new Date().toISOString(),
      source
    });

    // Cap length
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    state.workspaceHistory = history;
    this._saveState(state);
  }

  /** Remove a path from the compass history. */
  _removeFromCompass(workspacePath) {
    const resolvedPath = path.resolve(workspacePath);
    const state = this._loadState();
    if (!Array.isArray(state.workspaceHistory)) return;
    state.workspaceHistory = state.workspaceHistory.filter((h) => h.path !== resolvedPath);
    this._saveState(state);
  }

  // ── Legacy/global workspace ───────────────────────────────────────

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

  // ── Session-specific workspace methods ───────────────────────────

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

    // Also update global last + record in compass (same transaction, single save).
    // Only trustworthy workspaces enter the compass history — transient test paths and
    // MCP install dirs are excluded so they can never be auto-resumed later.
    state.globalLast = resolvedPath;
    if (!Array.isArray(state.workspaceHistory)) state.workspaceHistory = [];
    const nowIso = new Date().toISOString();
    let history = state.workspaceHistory.filter((h) => h.path !== resolvedPath);
    if (this._isTrustworthyWorkspace(resolvedPath)) {
      history.unshift({ path: resolvedPath, lastUsed: nowIso, source: 'explicit' });
    }
    state.workspaceHistory = history.slice(0, MAX_HISTORY_ENTRIES);

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
