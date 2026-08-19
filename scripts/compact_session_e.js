#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sessionPath = process.argv[2];
if (!sessionPath || !fs.existsSync(sessionPath)) {
  console.error('Usage: node compact_session.js <path-to-conversation.json> [--keep-last-n=2]');
  process.exit(1);
}

const keepLastN = Number(
  process.argv.find(arg => arg.startsWith('--keep-last-n='))?.split('=')[1] || 2
);

// 1. 创建备份
const backupDir = path.join(path.dirname(sessionPath), 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(
  backupDir,
  `${path.basename(sessionPath, '.json')}.bak_${Date.now()}.json`
);
fs.copyFileSync(sessionPath, backupPath);

const rawData = fs.readFileSync(sessionPath, 'utf8');
const data = JSON.parse(rawData);

let prunedStepsCount = 0;
let strippedGenInfoCount = 0;

if (Array.isArray(data.messages)) {
  const totalMessages = data.messages.length;

  data.messages.forEach((msg, msgIdx) => {
    const selectedVersion = msg.versions?.[msg.currentlySelected || 0];
    if (!selectedVersion || !Array.isArray(selectedVersion.steps)) return;

    const isRecent = msgIdx >= totalMessages - keepLastN;

    // 过滤无意义的 toolStatus 步骤
    selectedVersion.steps = selectedVersion.steps.filter((step) => {
      if (step.type === 'toolStatus' && !isRecent) {
        prunedStepsCount++;
        return false;
      }
      return true;
    });

    selectedVersion.steps.forEach((step) => {
      // 1. 彻底剥离历史步骤中的 genInfo 配置膨胀源 (Jinja 模板与全量 Schema)
      if (step.genInfo && !isRecent) {
        // 仅保留基础推理统计，删除巨量配置
        step.genInfo = {
          identifier: step.genInfo.identifier,
          stats: step.genInfo.stats
        };
        strippedGenInfoCount++;
      }

      // 2. 识别工具调用并关闭上下文注入
      const isToolStep =
        step.roleOverride === 'tool' ||
        step.content?.some(
          (c) => c.type === 'toolCallRequest' || c.type === 'toolCallResult'
        );

      if (isToolStep && !isRecent) {
        step.shouldIncludeInContext = false;
        step.defaultShouldIncludeInContext = false;

        // 3. 剪裁请求与响应的内容体
        if (Array.isArray(step.content)) {
          step.content.forEach((item) => {
            if (item.type === 'toolCallResult') {
              item.content = JSON.stringify([
                { type: 'text', text: `[Pruned Tool Result: ${item.name || 'executed'}]` }
              ]);
            }
            if (item.type === 'toolCallRequest' && item.parameters) {
              // 精简大参数（如长文件路径或内容），保留基础调用名
              const paramKeys = Object.keys(item.parameters);
              if (paramKeys.length > 3 || JSON.stringify(item.parameters).length > 200) {
                item.parameters = { _pruned: true, keys: paramKeys };
              }
            }
          });
        }
      }
    });
  });
}

// 4. 写回并展示清理指标
const outputJSON = JSON.stringify(data, null, 2);
fs.writeFileSync(sessionPath, outputJSON, 'utf8');

const originalSizeKB = (Buffer.byteLength(rawData) / 1024).toFixed(2);
const newSizeKB = (Buffer.byteLength(outputJSON) / 1024).toFixed(2);
const ratio = (((originalSizeKB - newSizeKB) / originalSizeKB) * 100).toFixed(1);

console.log(`[Compacted] ${path.basename(sessionPath)}`);
console.log(`- File Size: ${originalSizeKB} KB -> ${newSizeKB} KB (Saved ${ratio}%)`);
console.log(`- Pruned Status Steps: ${prunedStepsCount}`);
console.log(`- Stripped genInfo Bloat: ${strippedGenInfoCount}`);
console.log(`- Backup saved to: ${path.relative(process.cwd(), backupPath)}`);