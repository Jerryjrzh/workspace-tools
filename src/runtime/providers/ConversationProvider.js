import fs from 'fs';
import path from 'path';
import os from 'os';

class ConversationProvider {
  constructor(baseDir = null) {
    this.baseDir = baseDir;
  }

  getBaseDir() {
    return this.baseDir || path.join(os.homedir(), '.lmstudio', 'conversations');
  }

  ensureDirectory() {
    const baseDir = this.getBaseDir();
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
  }

  load(sessionId) {
    const baseDir = this.ensureDirectory();
    const filePath = path.join(baseDir, `${sessionId}.conversation.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  list() {
    const baseDir = this.ensureDirectory();
    return fs.readdirSync(baseDir)
      .filter((file) => file.endsWith('.conversation.json'))
      .map((file) => file.replace('.conversation.json', ''));
  }
}

export const conversationProvider = new ConversationProvider();
export default ConversationProvider;
