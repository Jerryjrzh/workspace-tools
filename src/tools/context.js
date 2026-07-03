// src/tools/context.js
import fs from 'fs';
import path from 'path';
import os from 'os';

export const contextTools = [
  {
    name: "context_anchor",
    description: "在长对话中设置上下文锚点：记录当前任务目标、已完成步骤、待完成步骤，防止模型在长上下文中迷失或重复",
    inputSchema: {
      type: "object",
      properties: {
        action: { 
          type: "string", 
          description: "操作类型: set=设置锚点 | get=读取当前锚点 | update_done=标记步骤完成 | reset=清除 | persist=持久化到磁盘 | resume=从磁盘恢复", 
          enum: ["set", "get", "update_done", "reset", "persist", "resume"] 
        },
        goal: { 
          type: "string", 
          description: "任务总目标（action=set 时使用）" 
        },
        steps: {
          type: "array",
          description: "任务步骤列表（action=set 时使用）",
          items: { type: "string" }
        },
        done_index: { 
          type: "number", 
          description: "标记第几步完成（0-indexed，action=update_done 时使用）" 
        },
        task_id: {
          type: "string",
          description: "任务唯一标识，用于跨会话恢复（可选，默认自动生成）"
        }
      },
      required: ["action"]
    }
  }
];

export async function handleContextTools(name, args, convId) {
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
  
  // 加载工作区日志
  let workspaceLog = { sessions: {} };
  try {
    if (fs.existsSync(logPath)) {
      workspaceLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
    
    // 确保sessions结构存在
    if (!workspaceLog.sessions) {
      workspaceLog.sessions = {};
    }
  } catch (error) {
    // 如果读取失败，初始化一个新的日志结构
    workspaceLog = { sessions: {} };
  }
  
  switch (name) {
    case "context_anchor": {
      const sessionId = convId || 'default';
      
      // 确保会话存在
      if (!workspaceLog.sessions[sessionId]) {
        workspaceLog.sessions[sessionId] = {};
      }
      
      switch (args.action) {
        case "set": {
          // 设置锚点
          workspaceLog.sessions[sessionId].anchor = {
            goal: args.goal || '',
            steps: args.steps || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          // 持久化到文件
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
          } catch (error) {
            return `⚠️ 设置锚点成功但持久化失败: ${error.message}`;
          }
          
          return `✅ 上下文锚点已设置:\n` +
                 `🎯 目标: ${args.goal || '未指定'}\n` +
                 `📋 步骤数: ${(args.steps || []).length}`;
        }
        
        case "get": {
          // 读取当前锚点
          const anchor = workspaceLog.sessions[sessionId]?.anchor;
          
          if (!anchor) {
            return `🔍 暂无上下文锚点设置\n` +
                   `💡 提示: 使用 context_anchor(action=\"set\") 首次设置锚点`;
          }
          
          return `🔍 当前上下文锚点状态:\n` +
                 `🎯 目标: ${anchor.goal || '未指定'}\n` +
                 `📋 总步骤: ${(anchor.steps || []).length}\n` +
                 `🕒 创建时间: ${new Date(anchor.createdAt).toLocaleString()}\n` +
                 `🔄 更新时间: ${new Date(anchor.updatedAt).toLocaleString()}`;
        }
        
        case "update_done": {
          // 标记步骤完成
          const anchor = workspaceLog.sessions[sessionId]?.anchor;
          
          if (!anchor) {
            return `❌ 未找到上下文锚点，请先使用 context_anchor(action=\"set\") 设置锚点`;
          }
          
          if (args.done_index === undefined || args.done_index < 0 || 
              args.done_index >= (anchor.steps || []).length) {
            return `❌ 无效的步骤索引: ${args.done_index}\n` +
                   `💡 有效范围: 0-${(anchor.steps || []).length - 1}`;
          }
          
          // 这里我们只是记录完成状态，实际应用中可能需要更复杂的逻辑
          workspaceLog.sessions[sessionId].lastUpdated = new Date().toISOString();
          workspaceLog.sessions[sessionId].completedStepIndex = args.done_index;
          
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
          } catch (error) {
            return `⚠️ 更新步骤状态成功但持久化失败: ${error.message}`;
          }
          
          return `✅ 步骤 ${args.done_index} 已标记为完成\n` +
                 `📋 当前任务: ${anchor.goal || '未指定'}\n` +
                 `📝 完成步骤: ${(anchor.steps || [])[args.done_index] || '未命名步骤'}`;
        }
        
        case "reset": {
          // 清除锚点
          delete workspaceLog.sessions[sessionId].anchor;
          
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
          } catch (error) {
            return `⚠️ 重置锚点成功但持久化失败: ${error.message}`;
          }
          
          return `🔄 上下文锚点已清除`;
        }
        
        case "persist": {
          // 持久化到磁盘（实际上我们已经在每次操作时持久化了）
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
            return `💾 上下文已持久化到磁盘: ${logPath}`;
          } catch (error) {
            return `❌ 持久化失败: ${error.message}`;
          }
        }
        
        case "resume": {
          // 从磁盘恢复（实际上我们已经在每次操作时从磁盘读取了）
          const anchor = workspaceLog.sessions[sessionId]?.anchor;
          
          if (!anchor) {
            return `🔄 暂无可恢复的上下文锚点\n` +
                   `💡 提示: 使用 context_anchor(action=\"set\") 首次设置锚点`;
          }
          
          return `🔄 从磁盘恢复上下文:\n` +
                 `🎯 目标: ${anchor.goal || '未指定'}\n` +
                 `📋 步骤数: ${(anchor.steps || []).length}\n` +
                 `🕒 上次更新: ${new Date(anchor.updatedAt).toLocaleString()}`;
        }
        
        default:
          throw new Error(`未知 context_anchor 操作: ${args.action}`);
      }
    }
    
    default:
      throw new Error(`未知上下文工具: ${name}`);
  }
}