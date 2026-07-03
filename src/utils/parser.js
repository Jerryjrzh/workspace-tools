// src/utils/parser.js
export class ConversationParser {
  /**
   * Extract workspace path from conversation text
   * @param {string} convText - JSON stringified conversation messages
   * @returns {string|null} - Extracted workspace path or null
   */
  static extractWorkspace(convText) {
    const wsMatch = convText.match(/(?:"text"\s*:\s*"当前workspace是\s*|workspace_set"\s*,\s*"parameters"\s*:\s*{\s*"path"\s*:*\s*)([^\s"'}]+)/i);
    return wsMatch && wsMatch[1] ? wsMatch[1] : null;
  }

  /**
   * Extract user messages from conversation data
   * @param {Object} convData - Parsed conversation JSON
   * @param {number} limit - Maximum number of messages to extract
   * @returns {Array<string>} - Array of user message texts
   */
  static extractUserMessages(convData, limit = 5) {
    const messages = convData.messages || [];
    return messages
      .filter(msg => msg.role === 'user')
      .slice(-limit)
      .map(msg => msg.content?.text || '')
      .filter(Boolean);
  }

  /**
   * Extract conversation metadata
   * @param {Object} convData - Parsed conversation JSON
   * @returns {Object} - Conversation metadata
   */
  static extractMetadata(convData) {
    return {
      name: convData.name || 'Unknown',
      model: convData.model || 'Unknown',
      messageCount: convData.messages?.length || 0,
      timestamp: convData.timestamp || new Date().toISOString()
    };
  }
}

export default ConversationParser;