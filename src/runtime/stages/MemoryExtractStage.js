import { memoryManager } from '../../managers/memory.js';
import { memoryProvider } from '../providers/MemoryProvider.js';

const EXPLICIT_REMEMBER_PATTERNS = [
  /请记住[：:]?\s*(.+)/i,
  /记住[：:]?\s*(.+)/i,
  /以后默认[：:]?\s*(.+)/i,
  /默认使用[：:]?\s*(.+)/i
];

const IDENTITY_PATTERNS = [
  { regex: /我是\s*(.+)/i, confidence: 0.92 },
  { regex: /我叫\s*(.+)/i, confidence: 0.95 },
  { regex: /我的职业是\s*(.+)/i, confidence: 0.9 },
  { regex: /我来自\s*(.+)/i, confidence: 0.88 }
];

const SOUL_PATTERNS = [
  { regex: /请用\s*(.+)回复/i, confidence: 0.92 },
  { regex: /请保持\s*(.+)风格/i, confidence: 0.9 },
  { regex: /回答要\s*(.+)/i, confidence: 0.85 },
  { regex: /默认(语言|语气|格式)是\s*(.+)/i, confidence: 0.92 }
];

const PREFERENCE_PATTERNS = [
  { regex: /我喜欢\s*(.+)/i, type: 'preference', confidence: 0.85 },
  { regex: /我主要(写|用|使用)\s*(.+)/i, type: 'preference', confidence: 0.9 },
  { regex: /我偏好\s*(.+)/i, type: 'preference', confidence: 0.85 },
  { regex: /默认(语言|框架|工具)是\s*(.+)/i, type: 'preference', confidence: 0.92 }
];

function getRecentUserMessages(conversation, limit = 3) {
  const messages = conversation?.messages || [];
  return messages
    .filter((message) => message.role === 'user')
    .slice(-limit)
    .map((message) => message.content?.text || message.content || '')
    .filter(Boolean);
}

function extractCandidatesFromText(text) {
  const candidates = [];

  for (const pattern of EXPLICIT_REMEMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      candidates.push({
        value: match[1].trim(),
        type: 'instruction',
        domain: 'session',
        confidence: 0.95,
        source: 'explicit'
      });
    }
  }

  for (const pattern of IDENTITY_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match?.[1]) {
      candidates.push({
        value: match[1].trim(),
        type: 'fact',
        domain: 'identity',
        confidence: pattern.confidence,
        source: 'extracted'
      });
    }
  }

  for (const pattern of SOUL_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match?.[1]) {
      candidates.push({
        value: match[1].trim(),
        type: 'preference',
        domain: 'soul',
        confidence: pattern.confidence,
        source: 'extracted'
      });
    }
  }

  for (const pattern of PREFERENCE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = (match[2] || match[1] || '').trim();
      if (value) {
        candidates.push({
          value,
          type: pattern.type,
          domain: 'soul',
          confidence: pattern.confidence,
          source: 'extracted'
        });
      }
    }
  }

  return candidates;
}

export async function MemoryExtractStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const manager = ctx.memoryManager || memoryManager;
  const provider = ctx.providerRegistry?.get?.('memory') || memoryProvider;
  const userMessages = getRecentUserMessages(ctx.conversation, 3);
  const candidates = userMessages.flatMap((text) => extractCandidatesFromText(text));

  const decisions = [];
  for (const candidate of candidates) {
    const decision = manager.processCandidate(sessionId, candidate);
    decisions.push(decision);
  }

  if (userMessages.length > 0) {
    manager.recordActivity(sessionId, {
      type: 'user_message',
      summary: userMessages[userMessages.length - 1].slice(0, 240)
    });
  }

  manager.dedupe(sessionId);
  ctx.memory = manager.loadStore(sessionId);
  ctx.memoryBackground = manager.getBackgroundContext(sessionId);
  ctx.state = ctx.state || {};
  ctx.state.memoryExtract = {
    candidates,
    decisions
  };
  ctx.session = ctx.session || {};
  ctx.session.memory = ctx.memory;
  ctx.session.memoryProvider = provider;
  ctx.session.memoryExtract = ctx.state.memoryExtract;
  ctx.session.memoryBackground = ctx.memoryBackground;
  return next();
}

export default MemoryExtractStage;
