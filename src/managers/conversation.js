// src/managers/conversation.js
import fs from 'fs';
import path from 'path';
import os from 'os';

class ConversationManager {
  constructor() {
    this.convDir = path.join(os.homedir(), '.lmstudio', 'conversations');
  }

  // Read and parse conversation file
  async loadConversation(convId) {
    const filePath = path.join(this.convDir, `${convId}.conversation.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Conversation file not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }

  // Extract workspace from conversation text
  extractWorkspaceFromConversation(convData) {
    const convText = JSON.stringify(convData.messages || []);
    
    // Precise extraction of user's last declared absolute path or historical feature
    const wsMatch = convText.match(/(?:"text"\s*:\s*"当前workspace是\s*|workspace_set"\s*,\s*"parameters"\s*:\s*{\s*"path"\s*:*\s*)([^\s"'}]+)/i);
    if (wsMatch && wsMatch[1]) {
      return wsMatch[1];
    }
    return null;
  }

  // Get latest conversation file
  async getLatestConversation() {
    if (!fs.existsSync(this.convDir)) {
      throw new Error('未检测到本地 LM Studio 会话数据层');
    }

    const files = fs.readdirSync(this.convDir)
      .filter(f => f.endsWith('.conversation.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(this.convDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      throw new Error('系统未发现任何活跃的历史上下文文件');
    }

    return files[0];
  }

  // Extract conversation summary for display
  extractConversationSummary(convData, maxMessages = 5) {
    const messages = convData.messages || [];
    const userMessages = messages
      .filter(msg => msg.role === 'user')
      .slice(-maxMessages)
      .map(msg => msg.content?.text || '');
    
    return {
      name: convData.name || 'Unknown',
      model: convData.model || 'Unknown',
      messageCount: messages.length,
      userMessages: userMessages.filter(Boolean)
    };
  }
}

export const conversationManager = new ConversationManager();