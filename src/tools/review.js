// src/tools/review.js
import fs from 'fs';
import path from 'path';

export const reviewTools = [
  {
    name: "lm_review",
    description: "用本地模型对代码/文本做专项审查（安全、性能、可读性、逻辑等），返回结构化建议",
    inputSchema: {
      type: "object",
      properties: {
        path: { 
          type: "string", 
          description: "要审查的文件路径（与 content 二选一）" 
        },
        content: { 
          type: "string", 
          description: "直接传入代码内容" 
        },
        focus: { 
          type: "string", 
          description: "审查重点: security | performance | readability | logic | all（默认 all）",
          enum: ["security", "performance", "readability", "logic", "all"]
        },
        language: { 
          type: "string", 
          description: "代码语言（可选，自动检测）" 
        }
      }
    }
  }
];

export async function handleReviewTools(name, args, convId) {
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  
  switch (name) {
    case "lm_review": {
      try {
        let codeContent = '';
        let fileName = '(直接传入的内容)';
        
        if (args.path) {
          const filePath = path.resolve(ws || process.cwd(), args.path);
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }
          codeContent = fs.readFileSync(filePath, 'utf8');
          fileName = args.path;
        } else if (args.content) {
          codeContent = args.content;
        } else {
          throw new Error(`必须提供 path 或 content 参数之一`);
        }
        
        // In a real implementation, this would call the actual review service via LM Studio API
        const focus = args.focus || 'all';
        const language = args.language || 'auto-detected';
        
        return `📋 代码审查报告:\\n` +
               `(这是一个简化实现，实际应调用模型进行专项审查)\\n` +
               `🎯 目标: ${fileName}\\n` +
               `🔍 重点: ${focus}\\n` +
               `💬 建议: 需要集成实际的代码审查服务\\n` +
               `📝 语言: ${language}\\n` +
               `📏 行数: ${codeContent.split('\\n').length}\\n` +
               `💾 大小: ${Buffer.byteLength(codeContent, 'utf8')}字节`;
      } catch (error) {
        return `❌ 代码审查失败: ${error.message}`;
      }
    }
    
    default:
      throw new Error(`未知审查工具: ${name}`);
  }
}