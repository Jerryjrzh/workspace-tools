#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sessionPath = process.argv[2];
if (!sessionPath || !fs.existsSync(sessionPath)) {
  console.error('Usage: node compact_session.js <path-to-conversation.json>');
  process.exit(1);
}

// 1. 自动安全备份
const backupPath = sessionPath.replace(/\.json$/, `.bak_${Date.now()}.json`);
fs.copyFileSync(sessionPath, backupPath);

const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

// 2. 遍历消息处理 shouldIncludeInContext 与冗余步骤
if (Array.isArray(data.messages)) {
  data.messages.forEach((msg, idx) => {
    const selectedVersion = msg.versions?.[msg.currentlySelected || 0];
    if (!selectedVersion || !Array.isArray(selectedVersion.steps)) return;

    // 保留最后 2 轮完整交互，其余历史轮次深度压缩
    const isRecent = idx >= data.messages.length - 2;

    selectedVersion.steps.forEach((step) => {
      // 检查是否为工具调用相关步骤
      const isToolStep = 
        step.type === 'toolStatus' ||
        step.roleOverride === 'tool' ||
        step.content?.some(c => c.type === 'toolCallRequest' || c.type === 'toolCallResult');

      if (isToolStep && !isRecent) {
        // 关键：关闭模型上下文注入
        step.shouldIncludeInContext = false;
        
        // 可选：物理缩减工具返回的超大 payload
        if (step.content) {
          step.content.forEach(c => {
            if (c.type === 'toolCallResult' && typeof c.content === 'string' && c.content.length > 500) {
              c.content = JSON.stringify([{ type: 'text', text: `[Content pruned: ${c.name} output]` }]);
            }
          });
        }
      }
    });
  });
}

// 3. 写回文件
fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`[Success] Context compacted safely. Backup created at: ${path.basename(backupPath)}`);