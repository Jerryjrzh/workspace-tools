// src/managers/sessionContextPersistence.js
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Session Context Persistence Manager
 * 
 * Saves and loads session context to disk for zero-latency recovery.
 * Session context is persisted to .sessions/{sessionId}.json
 */
class SessionContextPersistence {
  constructor() {
    this.sessionsDir = path.join(os.homedir(), '.lmstudio', 'sessions');
  }

  /**
   * Ensure sessions directory exists
   */
  ensureDirectory() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Save session context to disk
   * @param {string} sessionId - Session ID
   * @param {Object} context - Session context to save
   * @returns {Promise<void>}
   */
  async save(sessionId, context) {
    this.ensureDirectory();
    
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    const data = {
      sessionId,
      workspace: context.workspace || null,
      task: context.task || null,
      rules: context.rules || [],
      buffers: context.buffers || {},
      gitState: context.gitState || {},
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Load session context from disk
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} - Loaded session context
   */
  async load(sessionId) {
    this.ensureDirectory();
    
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    return {
      sessionId: data.sessionId,
      workspace: data.workspace || null,
      task: data.task || null,
      rules: data.rules || [],
      buffers: data.buffers || {},
      gitState: data.gitState || {}
    };
  }

  /**
   * Delete session context from disk
   * @param {string} sessionId - Session ID
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    this.ensureDirectory();
    
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Check if session context exists on disk
   * @param {string} sessionId - Session ID
   * @returns {boolean}
   */
  exists(sessionId) {
    this.ensureDirectory();
    
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    return fs.existsSync(filePath);
  }

  /**
   * List all persisted session IDs
   * @returns {string[]} - Array of session IDs
   */
  listSessions() {
    this.ensureDirectory();
    
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }
    
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}

export const sessionContextPersistence = new SessionContextPersistence();
export default SessionContextPersistence;