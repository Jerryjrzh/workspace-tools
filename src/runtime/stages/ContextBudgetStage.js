// src/runtime/stages/ContextBudgetStage.js
/**
 * ContextBudgetStage - 抑制 conversation 无限制增长，避免逼近 total context。
 *
 * 策略（按优先级）：
 *  1. token 预算估算：超过阈值时触发截断/摘要
 *  2. 消息数量截断：只保留最近 N 条 + 早期关键消息（system / 首个 user）
 *  3. 滚动摘要：对超出的旧消息生成摘要，替换原始内容（不丢失上下文要点）
 *
 * 该 stage 应插入在 RuntimeContextStage / ConversationLoadStage 之后，
 * 使 ctx.conversation.messages 在进入后续 stage 前已被抑制。
 */

// 默认配置
export const DEFAULT_CONFIG = {
  maxMessages: 20,          // 最多保留的消息条数（含摘要替换）
  keepRecent: 12,           // 始终保留的最近消息条数
  tokenBudget: 24000,       // conversation 总 token 预算（约 60k chars / 2.5）
  summaryKeepChars: 4000,   // 滚动摘要最多保留字符数
  totalContextTokens: null, // 模型上下文窗口大小；null 时回退到固定 tokenBudget
  systemPromptReserveRatio: 0.25 // 为 system prompt + tool result 预留的比例
};

// 粗略 token 估算：英文 ~1.3 tokens/word，中日文 ~1 token/char
function estimateTokens(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return Math.ceil(Math.max(words.length * 1.3, text.length));
}

// 从消息中提取可摘要的文本
function messageText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && Array.isArray(content)) {
    return content.map((part) => part?.text || '').join(' ');
  }
  if (content && typeof content === 'object' && content.text) return content.text;
  return '';
}

// 生成滚动摘要：把一批旧消息压缩为一条极简 summary（仅保留主题要点，不拼接全文）
function buildRollingSummary(messages, maxChars = DEFAULT_CONFIG.summaryKeepChars) {
  const texts = messages.map((m) => messageText(m)).filter(Boolean);
  if (texts.length === 0) return null;

  // 提取每条消息的首句作为要点（比拼接全文紧凑得多）
  const points = [];
  for (const text of texts) {
    const firstSentence = text.split(/[。！？.!?\n]/)[0].trim();
    if (firstSentence && !points.includes(firstSentence)) {
      points.push(firstSentence);
    }
  }

  let joined = `早期对话要点：${points.join('；')}`;
  // 超出预算则只保留首尾各若干条要点
  if (joined.length > maxChars) {
    const headCount = Math.max(2, Math.floor(points.length * 0.3));
    const tailCount = Math.max(1, points.length - headCount);
    joined = `早期对话要点：${points.slice(0, headCount).join('；')}…（省略 ${Math.max(0, tailCount)} 条）`;
  }

  return {
    role: 'system',
    content: { text: `[滚动摘要]\n${joined}` },
    summary: true,
    budgeted: true
  };
}

/**
 * 计算 system prompt（rules/skills/memory）的 token 占用。
 * ContextBudgetStage 位于 CapabilityContextStage 之前，因此这里从
 * ctx.rules / ctx.skills / ctx.retrievedMemory 等原始字段估算，
 * 而非依赖已构建好的 promptContext。
 */
export function estimateSystemPromptTokens(ctx = {}) {
  const parts = [];
  for (const rule of ctx.rules || []) {
    if (rule?.content) parts.push(rule.content);
  }
  for (const skill of ctx.skills || []) {
    const name = typeof skill === 'string' ? skill : skill?.name;
    if (name) parts.push(name);
  }
  for (const entry of ctx.retrievedMemory || []) {
    if (entry?.value) parts.push(entry.value);
  }
  return estimateTokens(parts.join('\n'));
}

/**
 * 根据总 context 动态计算 conversation 的 token 预算。
 *
 * @param {Object} options
 *   - totalContextTokens: 模型上下文窗口大小（如 128000）
 *   - systemPromptTokens: 当前请求 system prompt 已占用 token
 *   - reserveRatio: 为 tool result / 输出预留的比例
 * @returns {number|null} null 表示未配置总 context，回退固定预算
 */
export function computeConversationBudget(options = {}) {
  const {
    totalContextTokens,
    systemPromptTokens = 0,
    reserveRatio = DEFAULT_CONFIG.systemPromptReserveRatio
  } = options;

  if (!totalContextTokens || totalContextTokens <= 0) return null;
  // conversation 可用预算 = 总窗口 - (system prompt + tool result/输出预留)
  const reserved = Math.floor(totalContextTokens * reserveRatio);
  return Math.max(100, totalContextTokens - systemPromptTokens - reserved);
}

/**
 * 抑制 conversation：返回截断/摘要后的 messages，并附带预算统计。
 *
 * config.totalContextTokens 提供时，tokenBudget 会依据总 context 动态计算，
 * 而非使用固定值——这样抑制强度与模型实际上下文窗口大小相关。
 */
export function applyContextBudget(conversation, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!conversation || !Array.isArray(conversation.messages)) {
    return { messages: [], stats: null };
  }

  // 动态预算：若配置了 totalContextTokens，则据此计算 conversation 可用 token
  const effectiveBudget = cfg.totalContextTokens
    ? computeConversationBudget({
        totalContextTokens: cfg.totalContextTokens,
        systemPromptTokens: cfg.systemPromptTokens || 0,
        reserveRatio: cfg.systemPromptReserveRatio
      })
    : null;
  // conversation 预算不得超过固定默认值：小窗口（如 32k）的动态计算可能反而大于
  // tokenBudget，钳制后保证"窗口越小、预算越紧"，不会因配置总 context 而放宽。
  const budgetLimit = Math.min(effectiveBudget ?? Infinity, cfg.tokenBudget);

  const originalMessages = conversation.messages;
  let totalTokens = estimateTokens(
    originalMessages.map((m) => messageText(m)).join('\n')
  );

  // 未超预算且消息数在限制内：无需抑制
  if (totalTokens <= budgetLimit && originalMessages.length <= cfg.maxMessages) {
    return { messages: originalMessages, stats: null };
  }

  const keepRecent = Math.min(cfg.keepRecent, originalMessages.length);
  // 早期关键消息：system / 首个 user（保留上下文锚点）
  const earlyKeep = [];
  for (let i = 0; i < originalMessages.length - keepRecent; i += 1) {
    const msg = originalMessages[i];
    if (!msg || !messageText(msg)) continue;
    if (msg.role === 'system' || i === 0) {
      earlyKeep.push(msg);
    }
  }

  // 需要摘要的旧消息：除早期关键 + 最近 keepRecent 之外的部分
  const recentMessages = originalMessages.slice(-keepRecent);
  const midStart = Math.max(earlyKeep.length, 0);
  const midEnd = originalMessages.length - keepRecent;
  const summarizable = [];
  for (let i = midStart; i < midEnd; i += 1) {
    if (!earlyKeep.includes(originalMessages[i])) {
      summarizable.push(originalMessages[i]);
    }
  }

  let budgetedMessages = [...earlyKeep];
  // 若旧消息足够多，生成滚动摘要替换
  if (summarizable.length > 0) {
    const summary = buildRollingSummary(summarizable, cfg.summaryKeepChars);
    if (summary) budgetedMessages.push(summary);
  }
  budgetedMessages = [...budgetedMessages, ...recentMessages];

  // 二次校验：若仍超预算，进一步只保留最近消息
  const finalTokens = estimateTokens(budgetedMessages.map((m) => messageText(m)).join('\n'));
  if (finalTokens > budgetLimit && recentMessages.length > 0) {
    budgetedMessages = [...recentMessages];
  }

  return {
    messages: budgetedMessages,
    stats: {
      originalCount: originalMessages.length,
      budgetedCount: budgetedMessages.length,
      originalTokens: totalTokens,
      budgetedTokens: estimateTokens(budgetedMessages.map((m) => messageText(m)).join('\n')),
      tokenBudget: budgetLimit,
      effectiveTokenBudget: budgetLimit,
      totalContextTokens: cfg.totalContextTokens || null,
      systemPromptTokens: cfg.systemPromptTokens || 0,
      truncated: true
    }
  };
}

export async function ContextBudgetStage(ctx, next) {
  const conversation = ctx.conversation || { messages: [] };

  // 仅当存在真实消息时才抑制；空对话直接跳过
  if (!Array.isArray(conversation.messages) || conversation.messages.length === 0) {
    return next();
  }

  const budgetConfig = ctx.runtimeState?.contextBudget || DEFAULT_CONFIG;

  // 估算当前请求 system prompt（rules/skills/memory）已占用 token，
  // 使抑制强度与"总 context - 其他占用"相关，而非固定值。
  const systemPromptTokens = estimateSystemPromptTokens(ctx);
  const effectiveConfig = {
    ...budgetConfig,
    systemPromptTokens
  };

  const { messages, stats } = applyContextBudget(conversation, effectiveConfig);

  // 若发生抑制，更新 context 中的 conversation（不落盘原始文件，仅影响本次请求）
  if (stats) {
    ctx.conversation = {
      ...conversation,
      messages
    };
    ctx.session = ctx.session || {};
    ctx.session.contextBudget = stats;
    ctx.state = ctx.state || {};
    ctx.state.contextBudget = stats;

    // 暴露给后续 stage / tool，便于提示模型上下文已被压缩
    const totalContext = stats.totalContextTokens ? ` (总窗口 ${stats.totalContextTokens})` : '';
    ctx.executionHints = {
      ...(ctx.executionHints || {}),
      contextBudget: `conversation ${stats.originalCount}->${stats.budgetedCount} msgs, tokens ${stats.originalTokens}->${stats.budgetedTokens}, 预算 ${stats.effectiveTokenBudget}${totalContext}`
    };
  }

  return next();
}

export default ContextBudgetStage;
