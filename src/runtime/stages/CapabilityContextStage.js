import { buildPromptContext } from '../../managers/promptBuilder.js';

export async function CapabilityContextStage(ctx, next) {
  const rules = ctx.rules || [];
  const skills = ctx.skills || [];
  const allMemory = ctx.memory || { entries: [] };
  const retrievedMemory = ctx.retrievedMemory || [];

  const promptContext = buildPromptContext(ctx);

  ctx.capabilities = {
    ruleNames: rules.map((rule) => rule.name),
    skillNames: skills.map((skill) => skill.name || skill),
    memoryKeys: retrievedMemory.map((entry) => entry.key || entry),
    allMemoryCount: allMemory.entries?.length || 0,
    retrievedMemoryCount: retrievedMemory.length,
    summary: `Loaded ${rules.length} rules, ${skills.length} skills, retrieved ${retrievedMemory.length}/${allMemory.entries?.length || 0} memory entries`
  };

  ctx.promptContext = promptContext;
  ctx.executionHints = {
    summary: `rules=${ctx.capabilities.ruleNames.join(',')};skills=${ctx.capabilities.skillNames.join(',')};memory=${ctx.capabilities.memoryKeys.join(',')}`,
    systemPrompt: promptContext.systemPrompt || ''
  };

  ctx.session = ctx.session || {};
  ctx.session.capabilities = ctx.capabilities;
  ctx.session.promptContext = promptContext;
  ctx.session.memorySnapshot = {
    total: allMemory.entries?.length || 0,
    retrieved: retrievedMemory.length
  };
  return next();
}

export default CapabilityContextStage;
