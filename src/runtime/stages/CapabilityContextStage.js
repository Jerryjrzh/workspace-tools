import { buildPromptContext } from '../../managers/promptBuilder.js';

export async function CapabilityContextStage(ctx, next) {
  const rules = ctx.rules || [];
  const skills = ctx.skills || [];
  const allMemory = ctx.memory || { entries: [] };
  const retrievedMemory = ctx.retrievedMemory || [];
  const identityMemory = ctx.retrievedIdentityMemory || [];
  const soulMemory = ctx.retrievedSoulMemory || [];
  const workingMemory = ctx.retrievedWorkingMemory || [];

  const promptContext = buildPromptContext(ctx);
  const backgroundOrder = ctx.memory?.policies?.backgroundOrder || ['identity', 'soul', 'working', 'session'];
  const backgroundCounts = backgroundOrder.reduce((acc, domain) => {
    acc[domain] = (ctx.memoryBackground?.[domain] || []).length;
    return acc;
  }, {});

  ctx.capabilities = {
    ruleNames: rules.map((rule) => rule.name),
    skillNames: skills.map((skill) => skill.name || skill),
    memoryKeys: retrievedMemory.map((entry) => entry.key || entry),
    identityKeys: identityMemory.map((entry) => entry.key || entry),
    soulKeys: soulMemory.map((entry) => entry.key || entry),
    workingKeys: workingMemory.map((entry) => entry.key || entry),
    allMemoryCount: allMemory.entries?.length || 0,
    retrievedMemoryCount: retrievedMemory.length,
    identityMemoryCount: identityMemory.length,
    soulMemoryCount: soulMemory.length,
    workingMemoryCount: workingMemory.length,
    backgroundCounts,
    summary: `Loaded ${rules.length} rules, ${skills.length} skills, retrieved ${retrievedMemory.length}/${allMemory.entries?.length || 0} memory entries`
  };

  ctx.promptContext = promptContext;
  ctx.executionHints = {
    summary: `rules=${ctx.capabilities.ruleNames.join(',')};skills=${ctx.capabilities.skillNames.join(',')};memory=${ctx.capabilities.memoryKeys.join(',')}`,
    systemPrompt: promptContext.systemPrompt || '',
    backgroundOrder
  };

  ctx.session = ctx.session || {};
  ctx.session.capabilities = ctx.capabilities;
  ctx.session.promptContext = promptContext;
  ctx.session.memorySnapshot = {
    total: allMemory.entries?.length || 0,
    retrieved: retrievedMemory.length,
    identity: identityMemory.length,
    soul: soulMemory.length,
    working: workingMemory.length
  };
  return next();
}

export default CapabilityContextStage;
