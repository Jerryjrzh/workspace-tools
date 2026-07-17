import fs from 'fs';
import path from 'path';
import os from 'os';

export class MemoryProvider {
  constructor(baseDir = null) {
    this.baseDir = baseDir;
  }

  getMemoryDir() {
    return this.baseDir || path.join(os.homedir(), '.lmstudio', 'memory');
  }

  getFilePath(sessionId) {
    return path.join(this.getMemoryDir(), `${sessionId}.json`);
  }

  ensureDirectory() {
    const dir = this.getMemoryDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  load(sessionId) {
    if (!sessionId) {
      return { entries: [], profiles: { identity: [], soul: [] }, recentActivity: [] };
    }

    const filePath = this.getFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return { entries: [], profiles: { identity: [], soul: [] }, recentActivity: [] };
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        entries: Array.isArray(data.entries) ? data.entries : [],
        profiles: {
          identity: Array.isArray(data.profiles?.identity) ? data.profiles.identity : [],
          soul: Array.isArray(data.profiles?.soul) ? data.profiles.soul : []
        },
        recentActivity: Array.isArray(data.recentActivity) ? data.recentActivity : [],
        updatedAt: data.updatedAt || null
      };
    } catch {
      return { entries: [], profiles: { identity: [], soul: [] }, recentActivity: [] };
    }
  }

  save(sessionId, store) {
    if (!sessionId) {
      return null;
    }

    this.ensureDirectory();
    const filePath = this.getFilePath(sessionId);
    const payload = {
      entries: store.entries || [],
      profiles: {
        identity: Array.isArray(store.profiles?.identity) ? store.profiles.identity : [],
        soul: Array.isArray(store.profiles?.soul) ? store.profiles.soul : []
      },
      recentActivity: Array.isArray(store.recentActivity) ? store.recentActivity : [],
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  }
}

export const memoryProvider = new MemoryProvider();
export default MemoryProvider;
