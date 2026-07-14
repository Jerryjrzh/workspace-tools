import fs from 'fs';
import path from 'path';
import os from 'os';

export class SessionPersistenceProvider {
  constructor(baseDir = null) {
    this.baseDir = baseDir;
  }

  getBaseDir() {
    return this.baseDir || path.join(os.homedir(), '.lmstudio');
  }

  ensureDirectory(subdir) {
    const baseDir = path.join(this.getBaseDir(), subdir);
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
  }

  saveConversation(sessionId, conversation) {
    const dir = this.ensureDirectory('conversations');
    const filePath = path.join(dir, `${sessionId}.conversation.json`);
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf8');
    return filePath;
  }

  loadConversation(sessionId) {
    const dir = this.ensureDirectory('conversations');
    const filePath = path.join(dir, `${sessionId}.conversation.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  saveSessionState(sessionId, state) {
    const dir = this.ensureDirectory('sessions');
    const filePath = path.join(dir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    return filePath;
  }

  loadSessionState(sessionId) {
    const dir = this.ensureDirectory('sessions');
    const filePath = path.join(dir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  saveSnapshot(sessionId, snapshot) {
    const dir = this.ensureDirectory('snapshots');
    const filePath = path.join(dir, `${sessionId}.snapshot.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return filePath;
  }

  loadSnapshot(sessionId) {
    const dir = this.ensureDirectory('snapshots');
    const filePath = path.join(dir, `${sessionId}.snapshot.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
}

export const sessionPersistenceProvider = new SessionPersistenceProvider();
export default SessionPersistenceProvider;
