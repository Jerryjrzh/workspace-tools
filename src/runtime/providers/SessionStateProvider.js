import fs from 'fs';
import path from 'path';
import os from 'os';

export class SessionStateProvider {
  constructor(baseDir = null) {
    this.baseDir = baseDir;
  }

  getBaseDir() {
    return this.baseDir || path.join(os.homedir(), '.lmstudio', 'sessions');
  }

  ensureDirectory() {
    const baseDir = this.getBaseDir();
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
  }

  save(sessionId, state) {
    const baseDir = this.ensureDirectory();
    const statePath = path.join(baseDir, `${sessionId}.json`);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    return statePath;
  }

  load(sessionId) {
    const baseDir = this.ensureDirectory();
    const statePath = path.join(baseDir, `${sessionId}.json`);
    if (!fs.existsSync(statePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
}

export const sessionStateProvider = new SessionStateProvider();
