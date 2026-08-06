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
          description: "操作类型: set=设置锚点 | get=读取当前锚点 | update_done=标记步骤完成（支持批量 done_indices） | reset=清除 | persist=持久化到磁盘 | resume=从磁盘恢复", 
          enum: ["set", "get", "update_done", "reset", "persist", "resume"] 
        },
        goal: { 
          type: "string", 
          description: "任务总目标（action=set 时使用）" 
        },
        steps: {
          type: "array",
          description: "任务步骤列表（action=set 时使用）。可为字符串数组，或含 done/status 字段的对象数组以一次性初始化进度",
          items: { oneOf: [ { type: "string" }, { type: "object", properties: { text: {type:"string"}, done: {type:"boolean"} } } ] }
        },
        done_index: { 
          type: "number", 
          description: "标记第几步完成（0-indexed，action=update_done 时使用；与 done_indices 二选一）" 
        },
        done_indices: {
          type: "array",
          description: "批量标记多个已完成步骤（0-indexed 数组，action=update_done 时使用；一次调用即可更新全部已完成步骤，避免逐步骤多次调用）",
          items: { type: "number" }
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

export async function handleContextTools(name, args, context) {
  const convId = (typeof context === 'object' && context !== null)
    ? (context.sessionId || context.conversation_id || 'default')
    : (context || 'default');
  const ws = typeof convId === 'string' && convId ? undefined : process.cwd(); // Simplified for now
  const logPath = path.join(ws || process.cwd(), '.lmstudio-workspace.json');
  
  // 加载工作区日志
  let workspaceLog = { sessions: {} };
  try {
    if (fs.existsSync(logPath)) {
      const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      // 兼容旧格式：sessions 可能是数组（历史会话记录），统一归一化为对象映射。
      // context_anchor 依赖按 sessionId 索引的锚点，必须使用对象结构才能正确持久化。
      if (parsed && typeof parsed === 'object') {
        workspaceLog = { ...parsed };
        if (!workspaceLog.sessions || Array.isArray(workspaceLog.sessions)) {
          // 旧数组格式：仅保留非数字键（已有锚点），丢弃历史会话条目
          const anchorMap = {};
          if (Array.isArray(workspaceLog.sessions)) {
            Object.keys(workspaceLog.sessions).forEach(k => {
              if (!/^\d+$/.test(k) && workspaceLog.sessions[k]?.anchor) {
                anchorMap[k] = workspaceLog.sessions[k];
              }
            });
          }
          workspaceLog.sessions = anchorMap;
        }
      } else {
        workspaceLog = { sessions: {} };
      }
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
          // 设置锚点。steps 支持两种形态：
          //   1. 字符串数组 -> 全部未完成
          //   2. 对象数组（含 done/status）-> 一次性初始化进度，避免后续逐步骤 update_done
          const rawSteps = args.steps || [];
          let steps;
          if (rawSteps.length > 0 && typeof rawSteps[0] === 'object') {
            // 对象数组：提取 text + done 状态
            steps = rawSteps.map(s => ({
              index: s.index ?? -1,
              text: s.text || '',
              done: !!s.done || (s.status === 'done')
            }));
          } else {
            // 字符串数组：全部未完成，但可用 done_indices 一次性标记已完成步骤
            const doneSet = new Set(args.done_indices || []);
            steps = rawSteps.map((text, i) => ({
              index: i,
              text: typeof text === 'string' ? text : (text?.text || String(text)),
              done: doneSet.has(i)
            }));
          }
          
          workspaceLog.sessions[sessionId].anchor = {
            goal: args.goal || '',
            steps,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          const doneCount = steps.filter(s => s.done).length;
          
          // 持久化到文件
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
          } catch (error) {
            return `⚠️ 设置锚点成功但持久化失败: ${error.message}`;
          }
          
          return `✅ 上下文锚点已设置:\n` +
                 `🎯 目标: ${args.goal || '未指定'}\n` +
                 `📋 步骤数: ${steps.length}（已完成 ${doneCount}/${steps.length}）`;
        }
        
        case "get": {
          // 读取当前锚点
          const anchor = workspaceLog.sessions[sessionId]?.anchor;
          
          if (!anchor) {
            return `🔍 暂无上下文锚点设置\n` +
                   `💡 提示: 使用 context_anchor(action=\"set\") 首次设置锚点`;
          }
          
          const steps = anchor.steps || [];
          const doneCount = steps.filter(s => s.done).length;
          
          return `🔍 当前上下文锚点状态:\n` +
                 `🎯 目标: ${anchor.goal || '未指定'}\n` +
                 `📋 进度: ${doneCount}/${steps.length} 步骤完成\n` +
                 (steps.map((s, i) => 
                   `   [${s.done ? '✅' : '  '}] ${i + 1}. ${typeof s === 'string' ? s : (s.text || '')}`).join('\n')) +
                 `\n🕒 创建时间: ${new Date(anchor.createdAt).toLocaleString()}\n` +
                 `🔄 更新时间: ${new Date(anchor.updatedAt).toLocaleString()}`;
        }
        
        case "update_done": {
          // 标记步骤完成。支持两种方式：
          //   1. done_index: 单个步骤
          //   2. done_indices: 批量标记多个已完成步骤（一次调用即可更新全部进度，避免逐步骤多次调用）
          const anchor = workspaceLog.sessions[sessionId]?.anchor;
          
          if (!anchor) {
            return `❌ 未找到上下文锚点，请先使用 context_anchor(action=\"set\") 设置锚点`;
          }
          
          // 归一化待标记的索引集合
          let indicesToMark = [];
          if (Array.isArray(args.done_indices)) {
            indicesToMark = args.done_indices;
          } else if (args.done_index !== undefined) {
            indicesToMark = [args.done_index];
          }
          
          // 校验所有索引
          const totalSteps = (anchor.steps || []).length;
          const invalidIndices = indicesToMark.filter(i => 
            typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= totalSteps);
          if (invalidIndices.length > 0) {
            return `❌ 无效的步骤索引: ${JSON.stringify(invalidIndices)}\n` +
                   `💡 有效范围: 0-${totalSteps - 1}`;
          }
          
          // 标记完成（幂等：重复标记同一索引不报错）
          const marked = [];
          indicesToMark.forEach(i => {
            if (anchor.steps[i] && !anchor.steps[i].done) {
              anchor.steps[i].done = true;
              marked.push(i);
            }
          });
          
          workspaceLog.sessions[sessionId].lastUpdated = new Date().toISOString();
          const doneCount = anchor.steps.filter(s => s.done).length;
          
          try {
            fs.writeFileSync(logPath, JSON.stringify(workspaceLog, null, 2), 'utf8');
          } catch (error) {
            return `⚠️ 更新步骤状态成功但持久化失败: ${error.message}`;
          }
          
          if (marked.length === 0) {
            return `ℹ️ 无新增完成的步骤（${indicesToMark.join(', ') || '无'} 已标记过或无效）\n` +
                   `📋 当前进度: ${doneCount}/${totalSteps} — ${anchor.goal || '未指定'}`;
          }
          
          return `✅ 已完成 ${marked.length} 个步骤（${marked.map(i => i + 1).join(', ') || marked.join(',')}）\n` +
                 `📋 当前任务: ${anchor.goal || '未指定'}\n` +
                 `📈 进度: ${doneCount}/${totalSteps}`;
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
          
          const steps = anchor.steps || [];
          const doneCount = steps.filter(s => s.done).length;
          
          return `🔄 从磁盘恢复上下文:\n` +
                 `🎯 目标: ${anchor.goal || '未指定'}\n` +
                 `📋 进度: ${doneCount}/${steps.length} 步骤完成\n` +
                 (steps.map((s, i) => 
                   `   [${s.done ? '✅' : '  '}] ${i + 1}. ${typeof s === 'string' ? s : (s.text || '')}`).join('\n')) +
                 `\n🕒 上次更新: ${new Date(anchor.updatedAt).toLocaleString()}`;
        }
        
        default:
          throw new Error(`未知 context_anchor 操作: ${args.action}`);
      }
    }
    
    default:
      throw new Error(`未知上下文工具: ${name}`);
  }
}