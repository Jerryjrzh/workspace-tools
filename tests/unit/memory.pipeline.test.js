import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { WorkspaceStage } from '../../src/runtime/stages/WorkspaceStage.js';
import { RuleStage } from '../../src/runtime/stages/RuleStage.js';
import { SkillStage } from '../../src/runtime/stages/SkillStage.js';
import { MemoryStage } from '../../src/runtime/stages/MemoryStage.js';
import { MemoryExtractStage } from '../../src/runtime/stages/MemoryExtractStage.js';
import { MemoryRetrieveStage } from '../../src/runtime/stages/MemoryRetrieveStage.js';
import { CapabilityContextStage } from '../../src/runtime/stages/CapabilityContextStage.js';
import { PlannerStage } from '../../src/runtime/stages/PlannerStage.js';
import { MemoryProvider } from '../../src/runtime/providers/MemoryProvider.js';
import { MemoryManager } from '../../src/managers/memory.js';
import { ProviderRegistry } from '../../src/runtime/providers/ProviderRegistry.js';

function createTempEnvironment() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-pipeline-'));
  const workspace = path.join(tempHome, 'workspace');
  const memoryDir = path.join(tempHome, '.lmstudio', 'memory');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  return { tempHome, workspace, memoryDir };
}

test('memory pipeline extracts, retrieves, and injects prompt context', async () => {
  const { tempHome, workspace } = createTempEnvironment();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  const memoryProvider = new MemoryProvider(path.join(tempHome, '.lmstudio', 'memory'));
  const memoryManager = new MemoryManager(memoryProvider);
  memoryManager.remember('pipeline-session', {
    key: 'language',
    value: 'Prefers TypeScript',
    type: 'preference'
  });
  memoryManager.remember('pipeline-session', {
    key: 'platform',
    value: 'Uses OpenWrt for networking',
    type: 'fact'
  });

  try {
    const runtime = new AgentRuntime();
    const providerRegistry = new ProviderRegistry({ memory: memoryProvider });

    runtime.use(WorkspaceStage);
    runtime.use(RuleStage);
    runtime.use(SkillStage);
    runtime.use(MemoryStage);
    runtime.use(MemoryExtractStage);
    runtime.use(MemoryRetrieveStage);
    runtime.use(CapabilityContextStage);
    runtime.use(PlannerStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        retrievedCount: ctx.retrievedMemory?.length || 0,
        promptHasMemory: ctx.promptContext?.systemPrompt?.includes('<memory>') || false,
        plannerStrategy: ctx.executionPlan?.strategy || null
      };
      await next();
    });

    const ctx = await runtime.execute({
      sessionId: 'pipeline-session',
      task: 'networking',
      workspace,
      memoryManager,
      providerRegistry,
      conversation: {
        messages: [
          { role: 'user', content: { text: '请记住以后默认帮我写 TypeScript' } },
          { role: 'user', content: { text: '我在配置 OpenWrt 路由器' } }
        ]
      },
      toolRequest: {
        name: 'file_read',
        args: { path: 'README.md' },
        conversationId: 'pipeline-session'
      }
    });

    assert.ok(ctx.result.retrievedCount > 0);
    assert.equal(ctx.result.promptHasMemory, true);
    assert.equal(ctx.result.plannerStrategy, 'capability-aware');
    assert.ok(ctx.promptContext.systemPrompt.includes('Prefers TypeScript') || ctx.promptContext.systemPrompt.includes('OpenWrt'));
    assert.ok(ctx.capabilities.allMemoryCount >= 2);
    assert.ok(ctx.capabilities.retrievedMemoryCount <= ctx.capabilities.allMemoryCount);
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
