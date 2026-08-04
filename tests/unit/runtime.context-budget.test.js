import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContextBudget,
  computeConversationBudget,
  estimateSystemPromptTokens,
  DEFAULT_CONFIG,
  ContextBudgetStage
} from '../../src/runtime/stages/ContextBudgetStage.js';

function makeConversation(numMessages) {
  const messages = [];
  for (let i = 0; i < numMessages; i += 1) {
    if (i === 10) {
      messages.push({ role: 'system', content: { text: `系统规则锚点 #${i}` } });
      continue;
    }
    const isUser = i % 2 === 0;
    messages.push({
      role: isUser ? 'user' : 'assistant',
      content: {
        text: `${isUser ? '用户问题' : '助手回答'} ${i}: ` +
          (isUser
            ? '请帮我分析这个项目的架构，并给出优化建议。'
            : '好的，我已经分析了项目结构，发现以下关键点：模块化程度较高、依赖管理清晰、测试覆盖完善。')
      }
    });
  }
  return { name: 'test', messages };
}

test('小对话不触发抑制（消息数在限制内）', () => {
  const conversation = makeConversation(10);
  const result = applyContextBudget(conversation);
  assert.equal(result.stats, null);
  // 未抑制时返回原始 messages
  assert.equal(result.messages.length, conversation.messages.length);
});

test('大对话触发截断 + 滚动摘要', () => {
  const conversation = makeConversation(60);
  const result = applyContextBudget(conversation);

  assert.ok(result.stats, '应触发抑制');
  assert.equal(result.stats.originalCount, conversation.messages.length);
  assert.ok(result.stats.budgetedCount < result.stats.originalCount, '消息数应减少');

  // 最近消息必须保留（最后一条是 assistant）
  const lastMsg = result.messages[result.messages.length - 1];
  assert.equal(lastMsg.role, 'assistant');
  assert.ok((lastMsg.content?.text || '').includes('助手回答'), '最近消息内容应完整');

  // 滚动摘要已生成
  const hasSummary = result.messages.some((m) => m.summary === true);
  assert.ok(hasSummary, '应存在滚动摘要');
});

test('token 预算触发抑制（即使消息数不多）', () => {
  const conversation = makeConversation(15);
  for (const m of conversation.messages) {
    if (m.content?.text) {
      m.content.text += ' '.repeat(3000); // 拉高 token
    }
  }
  const result = applyContextBudget(conversation, { tokenBudget: 500 });
  assert.ok(result.stats, '应触发抑制');
});

test('空对话不触发抑制', () => {
  const result = applyContextBudget({ messages: [] });
  assert.equal(result.stats, null);
});

test('大长对话显著压缩 token（100条 -> ~15条）', () => {
  const messages = [];
  for (let i = 0; i < 200; i += 1) {
    if (i === 5) { messages.push({ role: 'system', content: { text: '系统锚点规则' } }); continue; }
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: { text: `${i % 2 === 0 ? '用户请求' : '助手回复'} #${i}: ` + '这是一段较长的上下文内容，包含项目分析、代码审查建议和后续执行计划。'.repeat(5) }
    });
  }
  const result = applyContextBudget({ messages });

  assert.ok(result.stats, '应触发抑制');
  assert.ok(result.stats.budgetedCount <= 15, `消息数应压缩到 ${result.stats.budgetedCount}`);
  // token 不应增长
  assert.ok(
    result.stats.budgetedTokens < result.stats.originalTokens,
    `token 应从 ${result.stats.originalTokens} 降到 ${result.stats.budgetedTokens}`
  );
});

test('ContextBudgetStage stage 集成：注入抑制后的 conversation', async () => {
  const ctx = {
    conversation: makeConversation(60),
    sessionId: 'budget-test',
    state: {},
    executionHints: {}
  };
  let nextCalled = false;
  await ContextBudgetStage(ctx, async () => { nextCalled = true; });

  assert.ok(nextCalled, 'next() 应被调用');
  assert.ok(ctx.session?.contextBudget, 'session 应记录预算统计');
  assert.ok(ctx.state?.contextBudget, 'state 应记录预算统计');

  // conversation 已被抑制
  const budgetedCount = ctx.conversation.messages.length;
  assert.ok(budgetedCount < 60, `conversation 应从 59 压缩到 ${budgetedCount}`);
});

// ---- 与 total context 相关的动态预算测试 ----

test('computeConversationBudget 依据总 context 动态计算 conversation 预算', () => {
  // 128k 窗口，20% 预留 -> conversation 可用约 96.8k
  const budget = computeConversationBudget({
    totalContextTokens: 131072,
    systemPromptTokens: 8000,
    reserveRatio: 0.2
  });
  assert.ok(budget > 90000, `预算应为 ${budget}`);

  // 未配置总 context -> null（回退固定预算）
  const noTotal = computeConversationBudget({});
  assert.equal(noTotal, null);
});

test('system prompt tokens 越大，conversation 可用预算越小', () => {
  const smallPrompt = computeConversationBudget({
    totalContextTokens: 131072,
    systemPromptTokens: 1000,
    reserveRatio: 0.2
  });
  const largePrompt = computeConversationBudget({
    totalContextTokens: 128000,
    systemPromptTokens: 50000,
    reserveRatio: 0.1
  });
  assert.ok(largePrompt < smallPrompt, 'system prompt 占用越多，conversation 预算越少');
});

test('配置 totalContextTokens 时抑制强度与总窗口相关', () => {
  const conversation = makeConversation(60);

  // 小窗口（32k）：预留后 conversation 预算很小 -> 触发抑制
  const smallWindow = applyContextBudget(conversation, { totalContextTokens: 32768 });
  assert.ok(smallWindow.stats, '小窗口应触发抑制');
  assert.equal(smallWindow.stats.totalContextTokens, 32768);
  // effectiveTokenBudget 不得超过固定默认值（小窗口被钳制到 tokenBudget）
  assert.ok(
    smallWindow.stats.effectiveTokenBudget <= DEFAULT_CONFIG.tokenBudget,
    `动态预算 ${smallWindow.stats.effectiveTokenBudget} 不应超过固定预算 ${DEFAULT_CONFIG.tokenBudget}`
  );

  // 大窗口（128k）：预留后 conversation 预算充足 -> 抑制更宽松
  const largeWindow = applyContextBudget(conversation, { totalContextTokens: 131072 });
  assert.ok(
    largeWindow.stats === null || largeWindow.stats.budgetedCount >= smallWindow.stats.budgetedCount,
    '大窗口抑制应更宽松'
  );
});

test('estimateSystemPromptTokens 估算 rules/skills/memory 占用', () => {
  const ctx = {
    rules: [{ name: 'r1', content: 'rule one '.repeat(20) }],
    skills: ['debug-skill'],
    retrievedMemory: [{ value: 'memory entry '.repeat(10) }]
  };
  const tokens = estimateSystemPromptTokens(ctx);
  assert.ok(tokens > 0, `应估算出 token，实际 ${tokens}`);
});
