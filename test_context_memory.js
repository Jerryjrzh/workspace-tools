// test_context_memory.js
// 测试当前会话 context 抑制与 memory 功能实际动作

import { memoryManager } from './src/managers/memory.js';
import { compactConversation } from './src/tools/contextCompact.js';

const SESSION_ID = 'test_session_ctx_mem_' + Date.now();

console.log('=== Memory 功能测试 ===');
console.log('Session ID:', SESSION_ID);

// 1. remember
const entry1 = memoryManager.remember(SESSION_ID, {
  key: 'user_name',
  value: '测试用户',
  type: 'fact',
  domain: 'session',
  source: 'explicit'
});
console.log('remember result:', entry1.id, entry1.key, entry1.value);

// 2. remember identity
const entry2 = memoryManager.remember(SESSION_ID, {
  key: 'preferred_language',
  value: '中文',
  type: 'preference',
  domain: 'soul',
  source: 'explicit'
});
console.log('remember soul:', entry2.id, entry2.key, entry2.value);

// 3. search
const searchResults = memoryManager.search(SESSION_ID, '测试用户', { limit: 5 });
console.log('search count:', searchResults.length);
console.log('search first:', searchResults[0]?.key, searchResults[0]?.value);

// 4. forget
const forgetResult = memoryManager.forget(SESSION_ID, 'user_name');
console.log('forget result:', forgetResult.removed ? 'FORGOTTEN' : 'NOT_FOUND');

// 5. background context
const bg = memoryManager.getBackgroundContext(SESSION_ID);
console.log('background context keys:', Object.keys(bg));
console.log('soul entries count:', (bg.soul || []).length);

console.log('\n=== Context 抑制测试 ===');

// 模拟对话数据
const mockConv = {
  messages: [
    { versions: [{ steps: [
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'toolCallRequest' } },
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'text' } }
    ]}]},
    { versions: [{ steps: [
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'toolCallResult' } },
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'text' } }
    ]}]},
    { versions: [{ steps: [
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'text' } }
    ]}]},
    { versions: [{ steps: [
      { shouldIncludeInContext: true, defaultShouldIncludeInContext: true, content: { type: 'text' } }
    ]}]}
  ]
};

const { data, stats } = compactConversation(JSON.parse(JSON.stringify(mockConv)), {
  keepRecentMessages: 2,
  suppressToolProcess: true
});

console.log('compact stats:', stats);
console.log('steps after compact:');
data.messages.forEach((msg, i) => {
  msg.versions[0].steps.forEach((step, j) => {
    console.log(` msg${i} step${j} shouldIncludeInContext=${step.shouldIncludeInContext}`);
  });
});

console.log('\n✅ 测试完成，Memory 与 Context 抑制功能均可正常调用');
