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
import { MemoryRetrieveStage } from '../../src/runtime/stages/MemoryRetrieveStage.js';
import { CapabilityContextStage } from '../../src/runtime/stages/CapabilityContextStage.js';

function createTempEnvironment() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-capabilities-'));
  const workspace = path.join(tempHome, 'workspace');
  const tasksDir = path.join(tempHome, '.lmstudio', 'tasks');
  const memoryDir = path.join(tempHome, '.lmstudio', 'memory');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  return { tempHome, workspace, tasksDir, memoryDir };
}

test('runtime capability stages load rules, skills, and memory for a session', async () => {
  const { tempHome, workspace, tasksDir, memoryDir } = createTempEnvironment();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  fs.writeFileSync(path.join(tempHome, '.lmstudio', 'global_rules.md'), '# global\n', 'utf8');
  fs.writeFileSync(path.join(tasksDir, 'coding.md'), '# coding\n', 'utf8');
  fs.writeFileSync(path.join(workspace, '.agent-rules.md'), '# workspace\n', 'utf8');
  fs.writeFileSync(path.join(workspace, '.agent-skills.json'), JSON.stringify([{ name: 'debug-skill' }]), 'utf8');
  fs.writeFileSync(path.join(memoryDir, 'capability-session.json'), JSON.stringify({ entries: [{ key: 'note', value: 'hello' }] }), 'utf8');

  try {
    const runtime = new AgentRuntime();
    runtime.use(WorkspaceStage);
    runtime.use(RuleStage);
    runtime.use(SkillStage);
    runtime.use(MemoryStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        rules: ctx.rules?.map((rule) => rule.name) || [],
        skills: ctx.skills?.map((skill) => skill.name) || [],
        memoryEntries: ctx.memory?.entries?.map((entry) => entry.key) || []
      };
      await next();
    });

    const ctx = await runtime.execute({
      sessionId: 'capability-session',
      task: 'coding',
      workspace,
      toolRequest: { name: 'capability_probe', args: {}, conversationId: 'capability-session' }
    });

    assert.ok(ctx.result.rules.includes('global_rules'));
    assert.ok(ctx.result.rules.includes('project_rules'));
    assert.ok(ctx.result.rules.includes('task_rules:coding'));
    assert.deepEqual(ctx.result.skills, ['debug-skill']);
    assert.deepEqual(ctx.result.memoryEntries, ['note']);
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('capability context is injected into the execution pipeline', async () => {
  const { tempHome, workspace } = createTempEnvironment();
  const oldHome = process.env.HOME;
  process.env.HOME = tempHome;

  fs.writeFileSync(path.join(tempHome, '.lmstudio', 'global_rules.md'), '# global\n', 'utf8');
  fs.writeFileSync(path.join(workspace, '.agent-skills.json'), JSON.stringify([{ name: 'debug-skill' }]), 'utf8');
  fs.writeFileSync(path.join(tempHome, '.lmstudio', 'memory', 'pipeline-session.json'), JSON.stringify({ entries: [{ key: 'note', value: 'hello' }] }), 'utf8');

  try {
    const runtime = new AgentRuntime();
    runtime.use(WorkspaceStage);
    runtime.use(RuleStage);
    runtime.use(SkillStage);
    runtime.use(MemoryStage);
    runtime.use(MemoryRetrieveStage);
    runtime.use(CapabilityContextStage);
    runtime.use(async (ctx, next) => {
      ctx.result = {
        capabilityNames: ctx.capabilities?.ruleNames || [],
        skillNames: ctx.capabilities?.skillNames || [],
        memoryKeys: ctx.capabilities?.memoryKeys || [],
        executionHint: ctx.executionHints?.summary || null
      };
      await next();
    });

    const ctx = await runtime.execute({
      sessionId: 'pipeline-session',
      task: 'coding',
      workspace,
      toolRequest: { name: 'capability_probe', args: {}, conversationId: 'pipeline-session' }
    });

    assert.ok(ctx.result.capabilityNames.includes('global_rules'));
    assert.deepEqual(ctx.result.skillNames, ['debug-skill']);
    assert.deepEqual(ctx.result.memoryKeys, ['note']);
    assert.ok(ctx.result.executionHint?.includes('rules'));
  } finally {
    if (oldHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = oldHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
