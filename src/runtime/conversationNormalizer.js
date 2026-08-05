// src/runtime/conversationNormalizer.js
/**
 * conversationNormalizer - 将 LM Studio 原生 conversation 格式归一化为
 * Runtime 统一使用的标准消息形状 `{ role, content: { text } }`。
 *
 * LM Studio 原生格式（versions[].currentlySelected）：
 *   user:      { type, role, content: [{ type:'text', text }, ...] }
 *   assistant: { type, role, senderInfo, steps: [
 *                { type:'contentBlock', content:[{type:'text',text}, {type:'toolCallRequest'...}] },
 *                { type:'toolCallResult', ... }, ...
 *              ]}
 *
 * 归一化后（ContextBudgetStage / MemoryExtractStage 依赖的形状）：
 *   { role: 'user'|'assistant', content: { text } }
 */

/**
 * 从 LM Studio 原生消息对象提取文本。
 * @param {Object} message - 原始消息
 * @returns {string}
 */
export function extractMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const sel = message.versions?.[message.currentlySelected] || message.versions?.[0];
  if (!sel) return '';

  // user / simple: content 数组
  const c = sel.content;
  if (Array.isArray(c)) {
    return extractPartsText(c);
  }
  if (typeof c === 'string') return c.trim();
  if (c?.text) return String(c.text).trim();

  // assistant multiStep: steps[]
  if (Array.isArray(sel.steps)) {
    const texts = [];
    for (const step of sel.steps) {
      const sc = step.content;
      if (Array.isArray(sc)) {
        // 只取 text 类型 part，跳过 toolCallRequest / toolCallResult
        for (const part of sc) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            texts.push(part.text);
          }
        }
      } else if (typeof sc === 'string') {
        texts.push(sc);
      } else if (sc?.text) {
        texts.push(String(sc.text));
      }
    }
    return texts.join(' ').trim();
  }

  // fallback: message.content
  const mc = message.content;
  if (Array.isArray(mc)) return extractPartsText(mc);
  if (typeof mc === 'string') return mc.trim();
  if (mc?.text) return String(mc.text).trim();

  return '';
}

/**
 * 提取 content part 数组中的文本（仅 text 类型）。
 */
function extractPartsText(parts = []) {
  const texts = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      texts.push(part.text);
    } else if (typeof part.text === 'string') {
      texts.push(part.text);
    }
  }
  return texts.join(' ').trim();
}

/**
 * 提取消息的 role。
 */
export function extractMessageRole(message) {
  const sel = message?.versions?.[message.currentlySelected] || message?.versions?.[0];
  if (sel?.role) return sel.role;
  if (message?.role) return message.role;
  // assistant multiStep 无顶层 role，但 steps 存在 → assistant
  if (Array.isArray(sel?.steps)) return 'assistant';
  return 'unknown';
}

/**
 * 归一化整个 conversation：把 messages[] 转为标准形状。
 *
 * @param {Object} rawConversation - LM Studio 原生 conversation（含 versions）
 * @returns {{name:string, messages:Array<{role,content:{text}}>, normalized:boolean}}
 */
export function normalizeConversation(rawConversation) {
  if (!rawConversation || typeof rawConversation !== 'object') {
    return { name: 'Unknown', messages: [], normalized: false };
  }

  const rawMessages = Array.isArray(rawConversation.messages)
    ? rawConversation.messages
    : [];

  // 检测是否为 LM Studio 原生格式（消息含 versions）
  const isNativeFormat = rawMessages.some((m) => m && typeof m === 'object' && Array.isArray(m.versions));

  if (!isNativeFormat) {
    return { name: rawConversation.name || 'Unknown', messages: rawMessages, normalized: false };
  }

  const messages = [];
  for (const raw of rawMessages) {
    const role = extractMessageRole(raw);
    const text = extractMessageText(raw);
    if (!text && !['user', 'assistant'].includes(role)) continue;
    // 跳过空文本消息（无内容可抑制/提取）
    messages.push({
      role,
      content: { text }
    });
  }

  return {
    name: rawConversation.name || 'Unknown',
    messages,
    normalized: true
  };
}

export default normalizeConversation;
