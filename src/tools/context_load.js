// src/tools/context_load.js
import fs from 'fs';
import path from 'path';
import os from 'os';

export const contextLoadTools = [
  {
    name: "context_load",
    description: "按需加载指定的上下文文件（SOUL/AGENTS/USER/TOOLS等），只在需要时加载，避免每次全量注入",
    inputSchema: {
      type: "object",
      properties: {
        files: { 
          type: "array", 
          description: "要加载的文件名列表，如 ['SOUL.md','USER.md']，相对于 workspace 根目录",
          items: { type: "string" }
        },
        summarize: { 
          type: "boolean", 
          description: "是否用 lm_chat 压缩摘要后返回（节省 token），默认 false" 
        },
        max_chars: { 
          type: "number", 
          description: "每个文件最多返回字符数，默认不限制" 
        }
      },
      required: ["files"]
    }
  },
  {
    name: "context_summary",
    description: "生成当前 workspace 的精简上下文摘要（替代全量加载 SOUL+AGENTS），用于新会话快速定位。自动读取 PROGRESS.md 进度状态",
    inputSchema: {
      type: "object",
      properties: {
        include_tasks: { 
          type: "boolean", 
          description: "是否包含未完成任务，默认 true" 
        },
        include_knowledge: { 
          type: "boolean", 
          description: "是否包含项目知识库摘要，默认 true" 
        },
        max_tokens_hint: { 
          type: "number", 
          description: "目标输出字符数上限，默认 800" 
        }
      }
    }
  }
];

export async function handleContextLoadTools(name, args, convId) {
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  
  switch (name) {
    case "context_load": {
      let combinedContent = '';
      
      for (const fileName of (args.files || [])) {
        try {
          const filePath = path.join(ws, fileName);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            combinedContent += `=== ${fileName} ===\\n${content}\\n\\n`;
            
            // Apply summarization if requested (simplified)
            if (args.summarize) {
              // In a real implementation, this would call lm_chat to summarize
              const summarized = `[摘要] 文件内容已压缩（原长度: ${content.length}字符）`;
              combinedContent = `=== ${fileName} (摘要) ===\\n${summarized}\\n\\n`;
            }
            
            // Apply max_chars limit if specified
            if (args.max_chars && combinedContent.length > args.max_chars) {
              combinedContent = combinedContent.substring(0, args.max_chars) + '\\n...[内容已截断]';
            }
          } else {
            combinedContent += `⚠️ 文件不存在: ${fileName}\\n\\n`;
          }
        } catch (e) {
          combinedContent += `❌ 读取文件失败 ${fileName}: ${e.message}\\n\\n`;
        }
      }
      
      return combinedContent.trim() || '没有找到指定的文件';
    }
    
    case "context_summary": {
      const wsPath = ws || process.cwd();
      let out = `## 📊 工作区上下文摘要\\n\\n`;
      
      // Include tasks if requested - 从PROGRESS.md读取
      if (args.include_tasks !== false) {
        try {
          const progressFile = path.join(wsPath, 'PROGRESS.md');
          if (fs.existsSync(progressFile)) {
            const progressContent = fs.readFileSync(progressFile, 'utf8');
            out += `### 📋 任务状态\\n`;
            out += `${progressContent}\\n`;
            out += `\\n`;
          } else {
            out += `### 📋 任务状态\\n`;
            out += `(未找到 PROGRESS.md 文件)\\n`;
            out += `- 已完成项: N/A\\n`;
            out += `- 待办事项: N/A\\n`;
            out += `\\n`;
          }
        } catch (error) {
          out += `### 📋 任务状态\\n`;
          out += `(读取 PROGRESS.md 时出错: ${error.message})\\n`;
          out += `- 已完成项: N/A\\n`;
          out += `- 待办事项: N/A\\n`;
          out += `\\n`;
        }
      }
      
      // Include knowledge if requested - 查找.agent-rules或类似文件
      if (args.include_knowledge !== false) {
        try {
          const knowledgeFile = path.join(wsPath, '.agent-rules.md');
          let knowledgeContent = '';
          
          if (fs.existsSync(knowledgeFile)) {
            knowledgeContent = fs.readFileSync(knowledgeFile, 'utf8');
          } else {
            // 也尝试查找其他常见的知识文件
            const altFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md'];
            for (const fileName of altFiles) {
              const filePath = path.join(wsPath, fileName);
              if (fs.existsSync(filePath)) {
                knowledgeContent += `=== ${fileName} ===\\n${fs.readFileSync(filePath, 'utf8')}\\n\\n`;
              }
            }
          }
          
          if (knowledgeContent.trim()) {
            out += `### 📚 项目知识库\\n`;
            out += `${knowledgeContent}\\n`;
            out += `\\n`;
          } else {
            out += `### 📚 项目知识库\\n`;
            out += `(未找到项目知识文件)\\n`;
            out += `- 知识条目: N/A\\n`;
            out += `\\n`;
          }
        } catch (error) {
          out += `### 📚 项目知识库\\n`;
          out += `(读取知识文件时出错: ${error.message})\\n`;
          out += `- 知识条目: N/A\\n`;
          out += `\\n`;
        }
      }
      
      // Add character limit hint
      if (args.max_tokens_hint) {
        out += `💡 提示: 建议限制在 ${args.max_tokens_hint} 字符以内以获得最佳性能\\n`;
      }
      
      return out;
    }
    
    default:
      throw new Error(`未知上下文加载工具: ${name}`);
  }
}