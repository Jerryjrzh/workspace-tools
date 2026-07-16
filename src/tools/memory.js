// src/tools/memory.js
import { memoryManager } from '../managers/memory.js';

export const memoryTools = [
  {
    name: 'memory_remember',
    description: '显式记住用户偏好或事实。仅用于用户明确提出“记住”类请求；自动记忆由 Runtime MemoryManager 处理。',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '记忆键名（可选，默认根据 value 生成）'
        },
        value: {
          type: 'string',
          description: '要记住的内容'
        },
        type: {
          type: 'string',
          description: '记忆类型，如 preference、fact、instruction',
          enum: ['preference', 'fact', 'instruction']
        }
      },
      required: ['value']
    }
  },
  {
    name: 'memory_forget',
    description: '显式删除一条记忆。用于用户明确提出“忘记”类请求。',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '要删除的记忆 key 或 id'
        }
      },
      required: ['key']
    }
  },
  {
    name: 'memory_search',
    description: '按关键词检索当前会话相关记忆，返回与查询最相关的条目。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词或上下文描述'
        },
        limit: {
          type: 'number',
          description: '最多返回条数，默认 8'
        }
      },
      required: ['query']
    }
  }
];

export async function handleMemoryTools(name, args, context) {
  const sessionId = context?.sessionId;
  if (!sessionId) {
    throw new Error('[memory] Session ID not found in context');
  }

  switch (name) {
    case 'memory_remember': {
      const entry = memoryManager.remember(sessionId, {
        key: args.key,
        value: args.value,
        type: args.type || 'fact',
        confidence: 1,
        source: 'explicit'
      });
      return {
        status: 'REMEMBERED',
        entry
      };
    }

    case 'memory_forget': {
      const result = memoryManager.forget(sessionId, args.key);
      return {
        status: result.removed ? 'FORGOTTEN' : 'NOT_FOUND',
        key: args.key
      };
    }

    case 'memory_search': {
      const entries = memoryManager.search(sessionId, args.query, {
        limit: args.limit || 8
      });
      return {
        status: 'OK',
        count: entries.length,
        entries
      };
    }

    default:
      throw new Error(`Unknown memory tool: ${name}`);
  }
}
