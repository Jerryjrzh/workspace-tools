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

  /**
   * Detect task type from conversation content
   */
  detectTaskType(convData) {
    const messages = convData.messages || [];
    const convTextLower = messages
      .map(m => m.content || '')
      .join(' ')
      .toLowerCase();

    const taskPatterns = {
      coding: [
        /编码|coding|实现|implement|开发|develop|函数|function|类|class|变量|variable/i,
        /修复|fix|bug|错误|error|优化|optimize|重构|refactor/i
      ],
      debug: [
        /调试|debug|故障|troubleshoot|问题|problem|异常|exception|崩溃|crash/i,
        /日志|log|trace|监控|monitor|性能|performance/i
      ],
      review: [
        /审查|review|检查|check|审计|audit|评估|evaluate|质量|quality/i,
        /安全|security|最佳实践|best practice|标准|standard|规范|specification/i
      ]
    };

    for (const [taskName, patterns] of Object.entries(taskPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(convTextLower)) {
          return taskName;
        }
      }
    }
    return null;
  }
}

export const conversationManager = new ConversationManager();
