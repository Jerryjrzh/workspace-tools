export async function CapabilityContextStage(ctx, next) {
  const rules = ctx.rules || [];
  const skills = ctx.skills || [];
  const memory = ctx.memory || { entries: [] };

  ctx.capabilities = {
    ruleNames: rules.map((rule) => rule.name),
    skillNames: skills.map((skill) => skill.name || skill),
    memoryKeys: (memory.entries || []).map((entry) => entry.key || entry),
    summary: `Loaded ${rules.length} rules, ${skills.length} skills, ${memory.entries?.length || 0} memory entries`
  };

  ctx.executionHints = {
    summary: `rules=${ctx.capabilities.ruleNames.join(',')};skills=${ctx.capabilities.skillNames.join(',')};memory=${ctx.capabilities.memoryKeys.join(',')}`
  };

  ctx.session = ctx.session || {};
  ctx.session.capabilities = ctx.capabilities;
  return next();
}
