// src/tools/embedding.js

export const embeddingTools = [
  {
    name: "lm_embed",
    description: "用本地 embedding 模型对文本列表做向量化，结果存入 workspace 向量库",
    inputSchema: {
      type: "object",
      properties: {
        texts: { 
          type: "array", 
          description: "要向量化的文本列表",
          items: { type: "string" }
        },
        ids: { 
          type: "array", 
          description: "每条文本的唯一 ID（可选，默认自动生成）",
          items: { type: "string" }
        },
        collection: { 
          type: "string", 
          description: "向量库集合名，默认 'default'" 
        },
        model: { 
          type: "string", 
          description: "embedding 模型 ID，默认 text-embedding-nomic-embed-text-v1.5" 
        }
      },
      required: ["texts"]
    }
  },
  {
    name: "semantic_search",
    description: "在本地向量库中做语义相似度搜索，找到最相关的文本片段",
    inputSchema: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "查询文本" 
        },
        collection: { 
          type: "string", 
          description: "向量库集合名，默认 'default'" 
        },
        top_k: { 
          type: "number", 
          description: "返回最相似的 K 条，默认 5" 
        },
        model: { 
          type: "string", 
          description: "embedding 模型 ID" 
        }
      },
      required: ["query"]
    }
  },
  {
    name: "embed_files",
    description: "将 workspace 中的文件内容分块向量化，建立语义索引（支持代码/文档）",
    inputSchema: {
      type: "object",
      properties: {
        include: { 
          type: "string", 
          description: "文件 glob，如 '**/*.py'，默认 '**/*.{py,js,ts,md}'" 
        },
        collection: { 
          type: "string", 
          description: "集合名，默认 workspace 名" 
        },
        chunk_size: { 
          type: "number", 
          description: "每块字符数，默认 500" 
        },
        model: { 
          type: "string", 
          description: "embedding 模型 ID" 
        }
      }
    }
  }
];

export async function handleEmbeddingTools(name, args, convId) {
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  
  switch (name) {
    case "lm_embed": {
      return `🔢 文本向量化结果:\n` +
             `(这是一个简化实现，实际应调用嵌入模型生成向量)\\n` +
             `📝 输入文本数: ${args.texts.length}\\n` +
             `💾 集合: ${args.collection || 'default'}\\n` +
             `🤖 模型: ${args.model || 'text-embedding-nomic-embed-text-v1.5'}\\n` +
             `⏳ 处理状态: 已提交请求（实际实现中将返回向量数据）`;
    }
    
    case "semantic_search": {
      return `🔍 语义搜索结果:\\n` +
             `(这是一个简化实现，实际应执行向量相似度搜索)\\n` +
             `❓ 查询: ${args.query}\\n` +
             `📊 返回数量: ${args.top_k || 5}\\n` +
             `💾 集合: ${args.collection || 'default'}`;
    }
    
    case "embed_files": {
      return `📁 文件向量化结果:\\n` +
             `(这是一个简化实现，实际应将文件内容分块并生成向量)\\n` +
             `📂 包含模式: ${args.include || '**/*.{py,js,ts,md}'}\\n` +
             `💾 集合: ${args.collection || path.basename(ws || process.cwd())}\\n` +
             `🧩 块大小: ${args.chunk_size || 500}字符`;
    }
    
    default:
      throw new Error(`未知嵌入工具: ${name}`);
  }
}