// src/tools/contextCompact.js
/**
 * session_context_compact - Task 完成后压缩 LM Studio 原始对话上下文。
 *
 * 目标：把 Task 执行过程（工具调用、中间步骤）和早期消息的 shouldIncludeInContext
 * 设为 false，仅保留最近会话 + memory。这样下次推理时进入模型的数据量大幅精简，
 * 避免前面所有过程全部走进去。
 *
 * 安全策略：
 *  1. 写回前自动备份到 ~/.lmstudio/conversations/backups/
 *  2. 只修改 shouldIncludeInContext，不删除任何消息（LM Studio 仍可回溯）
 *  3. 幂等：重复压缩不会重复抑制已抑制的步骤
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export const contextCompactTools = [
  {
    name: "session_context_compact",
    description: "Task 完成后压缩对话上下文：把 Task 执行过程（工具调用/中间步骤）和早期消息的 shouldIncludeInContext 设为 false，仅保留最近会话 + memory。下次推理时进入模型的数据量大幅精简。写回前自动备份到 backups/；支持 restore 从备份恢复原始状态。",
    inputSchema: {
      type: "object",
      properties: {
        action: { 
          type: "string", 
          description: "操作类型: compact=压缩（默认） | restore=从最近备份恢复原始上下文 | list_backups=列出可用备份", 
          enum: ["compact", "restore", "list_backups"] 
        },
        conversation_id: { 
          type: "string", 
          description: "要操作的 LM Studio 对话 ID（不填则用当前会话）" 
        },
        keep_recent_messages: { 
          type: "number", 
          description: "始终保留的最近消息条数，默认 4" 
        },
        suppress_tool_process: {
          type: "boolean",
          description: "是否抑制 Task 执行过程（含 toolCallRequest/toolCallResult 的步骤），默认 true"
        },
        dry_run: {
          type: "boolean",
          description: "仅预览将抑制哪些步骤，不写回文件。默认 false"
        }
      }
    }
  }
];

// 获取 LM Studio 原始对话目录
function getConversationsDir() {
  return path.join(os.homedir(), '.lmstudio', 'conversations');
}

// 备份原始文件到 backups/（带时间戳）
function backupFile(filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, '.json');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `${baseName}.${stamp}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

// 判断一个 contentBlock step 是否属于 Task 执行过程（含工具调用/结果）
function isToolProcessStep(step) {
  if (!step || typeof step !== 'object') return false;
  const content = step.content;
  let hasToolCall = false;
  function scan(obj) {
    if (Array.isArray(obj)) { obj.forEach(scan); return; }
    if (obj && typeof obj === 'object') {
      if (obj.type === 'toolCallRequest' || obj.type === 'toolCallResult') {
        hasToolCall = true;
      }
      Object.values(obj).forEach(scan);
    }
  }
  scan(content);
  return hasToolCall;
}

/**
 * 压缩对话：返回抑制后的数据 + 统计。
 *
 * @param {Object} convData - LM Studio 原始对话 JSON
 * @param {Object} options - keepRecentMessages / suppressToolProcess
 */
export function compactConversation(convData, options = {}) {
  const cfg = {
    keepRecentMessages: options.keepRecentMessages ?? 4,
    suppressToolProcess: options.suppressToolProcess ?? true
  };

  if (!convData || !Array.isArray(convData.messages)) {
    return { data: convData, stats: null };
  }

  const messages = convData.messages;
  const keepRecent = Math.min(cfg.keepRecentMessages, messages.length);
  const recentStartIndex = messages.length - keepRecent;

  let suppressedSteps = 0;
  let keptSteps = 0;
  let totalSteps = 0;

  // 遍历每条消息的 versions[0].steps，决定 shouldIncludeInContext
  for (let mi = 0; mi < messages.length; mi += 1) {
    const msg = messages[mi];
    if (!msg || typeof msg !== 'object') continue;
    const version = Array.isArray(msg.versions) ? msg.versions[0] : null;
    if (!version || !Array.isArray(version.steps)) continue;

    // 该消息是否属于"最近保留区"
    const isRecentMessage = mi >= recentStartIndex;

    for (const step of version.steps) {
      if (!step || typeof step !== 'object') continue;
      if (!('shouldIncludeInContext' in step)) continue;

      totalSteps += 1;
      const defaultVal = step.defaultShouldIncludeInContext ?? true;

      // 决定是否抑制：
      //   - 最近消息：始终保留
      //   - 早期消息 + Task 过程步骤（工具调用/结果）：抑制
      let shouldSuppress = false;
      if (!isRecentMessage) {
        // 早期消息默认抑制；若配置了 suppressToolProcess，则所有早期 contentBlock 都抑制
        shouldSuppress = true;
      } else if (cfg.suppressToolProcess && isToolProcessStep(step)) {
        // 最近消息中的 Task 过程步骤（工具调用/结果）也抑制，只保留文本结论
        shouldSuppress = true;
      }

      const targetValue = !shouldSuppress;

      // 记录统计
      if (targetValue) keptSteps += 1;
      else suppressedSteps += 1;

      // 写回目标值（幂等：若已是目标值则跳过）
      step.shouldIncludeInContext = targetValue;
    }
  }

  return {
    data: convData,
    stats: {
      totalSteps,
      keptSteps,
      suppressedSteps,
      keepRecentMessages: cfg.keepRecentMessages,
      suppressToolProcess: cfg.suppressToolProcess
    }
  };
}

export async function handleContextCompactTools(name, args, context) {
  const sessionId = (typeof context === 'object' && context !== null)
    ? (context.sessionId || context.conversation_id || 'default')
    : (context || 'default');

  switch (name) {
    case "session_context_compact": {
      // 确定目标对话 ID：优先用参数，否则当前会话
      const targetConv = args.conversation_id || sessionId;
      if (!targetConv || targetConv === 'default') {
        return `❌ 无法确定要操作的对话 ID。请传入 conversation_id 或确保当前会话已初始化。`;
      }

      // LM Studio 原始对话文件路径
      const convDir = getConversationsDir();
      const filePath = path.join(convDir, `${targetConv}.conversation.json`);
      if (!fs.existsSync(filePath)) {
        return `❌ 未找到对话文件: ${filePath}`;
      }

      // action：compact（默认）| restore | list_backups
      const action = args.action || 'compact';

      // ---- list_backups：列出可用备份 ----
      if (action === 'list_backups') {
        const backupDir = path.join(convDir, 'backups');
        if (!fs.existsSync(backupDir)) {
          return `📋 暂无备份记录。执行 compact 时会自动创建备份到 ${backupDir}`;
        }
        const files = fs.readdirSync(backupDir)
          .filter(f => f.includes(targetConv))
          .sort((a, b) => b.localeCompare(a));
        if (files.length === 0) {
          return `📋 该对话暂无备份。`;
        }
        let out = `📦 ${targetConv} 的可用备份 (${files.length} 个):\n\n`;
        files.forEach((f, i) => {
          const stat = fs.statSync(path.join(backupDir, f));
          out += `${i + 1}. ${f}\n   📏 ${stat.size} bytes | 🕒 ${new Date(stat.mtime).toLocaleString()}\n`;
        });
        return out.trim();
      }

      // ---- restore：从最近备份恢复原始状态 ----
      if (action === 'restore') {
        const backupDir = path.join(convDir, 'backups');
        const files = fs.existsSync(backupDir)
          ? fs.readdirSync(backupDir).filter(f => f.includes(targetConv)).sort((a, b) => b.localeCompare(a))
          : [];
        if (files.length === 0) {
          return `❌ 未找到 ${targetConv} 的备份，无法恢复。`;
        }
        const latestBackup = path.join(backupDir, files[0]);
        try {
          fs.copyFileSync(latestBackup, filePath);
        } catch (error) {
          return `❌ 恢复失败: ${error.message}`;
        }
        return `✅ 已从备份恢复原始上下文:\n` +
               `📦 备份文件: ${files[0]}\n` +
               `🔄 ${filePath} 已恢复到压缩前状态`;
      }

      // ---- compact：执行压缩 ----
      // 读取原始对话
      let convData;
      try {
        convData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        return `❌ 解析对话文件失败: ${error.message}`;
      }

      const options = {
        keepRecentMessages: args.keep_recent_messages ?? 4,
        suppressToolProcess: args.suppress_tool_process ?? true
      };

      // dry_run：仅预览，不写回
      if (args.dry_run) {
        const { stats } = compactConversation(JSON.parse(JSON.stringify(convData)), options);
        return `🔍 压缩预览（dry-run）:\n` +
               `📋 总步骤: ${stats.totalSteps}\n` +
               `✅ 保留: ${stats.keptSteps} 步骤\n` +
               `🚫 将抑制: ${stats.suppressedSteps} 步骤\n` +
               `💡 最近保留消息数: ${options.keepRecentMessages}\n` +
               (options.suppressToolProcess ? `🔧 已启用 Task 过程抑制（工具调用/结果）\n` : ``) +
               `⚠️ dry-run 未写回文件`;
      }

      // 备份原始文件
      let backupPath;
      try {
        backupPath = backupFile(filePath);
      } catch (error) {
        return `❌ 备份失败，已中止压缩: ${error.message}`;
      }

      // 执行压缩（直接修改 convData）
      const { data, stats } = compactConversation(convData, options);

      // 写回
      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (error) {
        return `❌ 写回失败: ${error.message}（原始文件已备份到 ${backupPath}）`;
      }

      return `✅ 对话上下文已压缩:\n` +
             `📋 总步骤: ${stats.totalSteps}\n` +
             `✅ 保留进入推理: ${stats.keptSteps} 步骤\n` +
             `🚫 抑制（shouldIncludeInContext=false）: ${stats.suppressedSteps} 步骤\n` +
             `💾 备份: ${backupPath}\n` +
             `📌 下次推理时，被抑制的 Task 过程将不再进入模型上下文`;
    }

    default:
      throw new Error(`未知 context compact 工具: ${name}`);
  }
}

export default handleContextCompactTools;
