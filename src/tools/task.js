// src/tools/task.js
import fs from 'fs';
import path from 'path';
import os from 'os';

export const taskTools = [
  {
    name: "task_checkpoint",
    description: "保存任务执行检查点到磁盘，session 中断后可用 task_resume 恢复。每完成一个子步骤后调用",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { 
          type: "string", 
          description: "任务唯一 ID（同一任务保持一致）" 
        },
        goal: { 
          type: "string", 
          description: "任务总目标描述" 
        },
        steps: {
          type: "array",
          description: "完整步骤列表",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              text: { type: "string" },
              status: { 
                type: "string", 
                description: "pending | running | done | failed" 
              },
              result: { 
                type: "string", 
                description: "执行结果摘要（可选）" 
              }
            },
            required: ["index", "text", "status"]
          }
        },
        current_step: { 
          type: "number", 
          description: "当前执行到第几步（0-indexed）" 
        },
        context: {
          type: "object",
          description: "任意需要跨会话保留的上下文数据（文件路径、变量值等）"
        }
      },
      required: ["task_id", "goal", "steps"]
    }
  },
  {
    name: "task_resume",
    description: "从磁盘恢复上次中断的任务状态，返回任务目标、已完成步骤、下一步待执行内容",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { 
          type: "string", 
          description: "要恢复的任务 ID（不填则列出所有未完成任务）" 
        }
      }
    }
  },
  {
    name: "task_list",
    description: "列出所有持久化的任务（包括已完成和未完成）",
    inputSchema: {
      type: "object",
      properties: {
        status: { 
          type: "string", 
          description: "过滤状态，默认 pending", 
          enum: ["all", "pending", "done"] 
        }
      }
    }
  }
];

export async function handleTaskTools(name, args, convId) {
  // Use workspace from context or fallback to global
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  
  switch (name) {
    case "task_checkpoint": {
      // In a real implementation, this would save to persistent storage
      // For now, we'll save to workspace directory
      const checkpointDir = path.join(ws || process.cwd(), '.lmstudio-task-checkpoints');
      try {
        if (!fs.existsSync(checkpointDir)) {
          fs.mkdirSync(checkpointDir, { recursive: true });
        }
        
        const checkpointFile = path.join(checkpointDir, `${args.task_id}.json`);
        const checkpointData = {
          taskId: args.task_id,
          goal: args.goal,
          steps: args.steps,
          currentStep: args.current_step,
          context: args.context || {},
          timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData, null, 2), 'utf8');
        
        return `✅ 任务检查点已保存到: ${checkpointFile}\n` +
               `📝 检查点内容: ${args.goal || '未指定目标'}`;
      } catch (error) {
        return `❌ 保存任务检查点失败: ${error.message}`;
      }
    }
    
    case "task_resume": {
      // In a real implementation, this would load from persistent storage
      const checkpointDir = path.join(ws || process.cwd(), '.lmstudio-task-checkpoints');
      
      if (!fs.existsSync(checkpointDir)) {
        return `📋 暂无任务检查点记录\n` +
               `💡 提示: 首次使用 task_checkpoint 保存检查点后才能恢复`;
      }
      
      try {
        const files = fs.readdirSync(checkpointDir)
          .filter(f => f.endsWith('.json'))
          .map(f => ({ 
            name: f, 
            mtime: fs.statSync(path.join(checkpointDir, f)).mtimeMs,
            content: JSON.parse(fs.readFileSync(path.join(checkpointDir, f), 'utf8'))
          }))
          .sort((a, b) => b.mtime - a.mtime); // 最新的在前
        
        if (args.task_id) {
          // 查找特定任务ID
          const taskFile = files.find(f => f.content.taskId === args.task_id);
          if (!taskFile) {
            return `❌ 未找到任务 ID: ${args.task_id}\n` +
                   `💡 可用的任务 ID: ${files.map(f => f.content.taskId).join(', ')}`;
          }
          
          const task = taskFile.content;
          const completedSteps = task.steps.filter(s => s.status === 'done').length;
          const totalSteps = task.steps.length;
          
          return `🔄 从检查点恢复任务:\n` +
                 `🎯 任务 ID: ${task.taskId}\n` +
                 `📋 总目标: ${task.goal}\n` +
                 `📈 进度: ${completedSteps}/${totalSteps} 步骤完成\n` +
                 `⏳ 当前步骤: ${task.currentStep || 0}\n` +
                 `🕒 上次更新: ${new Date(task.timestamp).toLocaleString()}\n` +
                 (task.context && Object.keys(task.context).length > 0 ? 
                  `📊 上下文数据: ${JSON.stringify(task.context, null, 2)}\n` : '');
        } else {
          // 列出所有未完成的任务
          const pendingTasks = files.filter(f => 
            f.content.steps.some(s => s.status !== 'done')
          );
          
          if (pendingTasks.length === 0) {
            return `✅ 没有待处理的任务\n` +
                   `📋 所有任务已完成或暂无任务记录`;
          }
          
          let out = `📋 未完成任务列表 (共 ${pendingTasks.length} 项):\n\\n`;
          pendingTasks.forEach((taskFile, index) => {
            const task = taskFile.content;
            const completedSteps = task.steps.filter(s => s.status === 'done').length;
            const totalSteps = task.steps.length;
            
            out += `${index + 1}. 任务 ID: ${task.taskId}\n`;
            out += `   🎯 目标: ${task.goal}\n`;
            out += `   📈 进度: ${completedSteps}/${totalSteps} 步骤完成\n`;
            out += `   ⏳ 当前步骤: ${task.currentStep || 0}\n`;
            out += `   🕒 上次更新: ${new Date(task.timestamp).toLocaleString()}\\n\\n`;
          });
          
          return out.trim();
        }
      } catch (error) {
        return `❌ 读取任务检查点失败: ${error.message}`;
      }
    }
    
    case "task_list": {
      // In a real implementation, this would load from persistent storage
      const checkpointDir = path.join(ws || process.cwd(), '.lmstudio-task-checkpoints');
      
      if (!fs.existsSync(checkpointDir)) {
        return `📋 暂无任务记录\n` +
               `💡 提示: 使用 task_checkpoint 首次保存检查点后才能列出任务`;
      }
      
      try {
        const files = fs.readdirSync(checkpointDir)
          .filter(f => f.endsWith('.json'))
          .map(f => ({ 
            name: f, 
            mtime: fs.statSync(path.join(checkpointDir, f)).mtimeMs,
            content: JSON.parse(fs.readFileSync(path.join(checkpointDir, f), 'utf8'))
          }))
          .sort((a, b) => b.mtime - a.mtime); // 最新的在前
        
        let filteredFiles = files;
        if (args.status && args.status !== 'all') {
          filteredFiles = files.filter(f => {
            if (args.status === 'done') {
              return f.content.steps.every(s => s.status === 'done');
            } else if (args.status === 'pending') {
              return f.content.steps.some(s => s.status !== 'done');
            }
            return true;
          });
        }
        
        if (filteredFiles.length === 0) {
          const statusText = args.status || 'pending';
          return `📋 没有找到状态为 '${statusText}' 的任务\n` +
                 `💡 提示: 所有任务可能已完成或暂无任务记录`;
        }
        
        let out = `📋 任务列表 (共 ${filteredFiles.length} 项):\n\\n`;
        filteredFiles.forEach((taskFile, index) => {
          const task = taskFile.content;
          const completedSteps = task.steps.filter(s => s.status === 'done').length;
          const totalSteps = task.steps.length;
          const status = completedSteps === totalSteps ? 'done' : 
                        completedSteps > 0 ? 'in_progress' : 'pending';
                        
          out += `${index + 1}. [${status}] 任务 ID: ${task.taskId}\n`;
          out += `   🎯 目标: ${task.goal}\n`;
          out += `   📈 进度: ${completedSteps}/${totalSteps} 步骤完成\n`;
          if (task.context && Object.keys(task.context).length > 0) {
            out += `   📊 上下文: ${Object.keys(task.context).length} 项数据\n`;
          }
          out += `   🕒 更新时间: ${new Date(task.timestamp).toLocaleString()}\\n\\n`;
        });
        
        return out.trim();
      } catch (error) {
        return `❌ 读取任务列表失败: ${error.message}`;
      }
    }
    
    default:
      throw new Error(`未知任务工具: ${name}`);
  }
}