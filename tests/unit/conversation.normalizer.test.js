import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConversation, extractMessageText } from '../../src/runtime/conversationNormalizer.js';

// LM Studio 原生格式样例
const nativeUserMsg = {
  versions: [
    {
      type: 'singleStep',
      role: 'user',
      content: [{ type: 'text', text: '请记住我的工作目录' }]
    }
  ],
  currentlySelected: 0
};

const nativeAssistantMsg = {
  versions: [
    {
      type: 'multiStep',
      role: 'assistant',
      senderInfo: {},
      steps: [
        { type: 'contentBlock', content: [{ type: 'text', text: '好的，我来处理。' }] },
        { type: 'toolCallRequest', callId: 'c1', name: 'file_read', parameters: {} }
      ]
    }
  ],
  currentlySelected: 0
};

test('extractMessageText reads user content array', () => {
  assert.equal(extractMessageText(nativeUserMsg), '请记住我的工作目录');
});

test('extractMessageText reads assistant steps, skipping tool calls', () => {
  // 只提取 text 类型 part，跳过 toolCallRequest
  const text = extractMessageText(nativeAssistantMsg);
  assert.equal(text, '好的，我来处理。');
});

test('normalizeConversation converts native format to standard shape', () => {
  const raw = {
    name: 'Test',
    messages: [nativeUserMsg, nativeAssistantMsg]
  };

  const norm = normalizeConversation(raw);

  assert.equal(norm.normalized, true);
  assert.equal(norm.messages.length, 2);
  assert.deepEqual(norm.messages[0], { role: 'user', content: { text: '请记住我的工作目录' } });
  assert.deepEqual(norm.messages[1], { role: 'assistant', content: { text: '好的，我来处理。' } });
});

test('normalizeConversation passes through already-standard conversations unchanged', () => {
  const raw = {
    name: 'Standard',
    messages: [
      { role: 'user', content: { text: 'hello' } },
      { role: 'assistant', content: { text: 'hi' } }
    ]
  };

  const norm = normalizeConversation(raw);
  assert.equal(norm.normalized, false); // not native format
  assert.equal(norm.messages.length, 2);
});

test('normalizeConversation handles empty / malformed input', () => {
  const empty = normalizeConversation(null);
  assert.deepEqual(empty.messages, []);

  const noMessages = normalizeConversation({ name: 'X' });
  assert.deepEqual(noMessages.messages, []);
});
