const TOOL_CAPABILITY_HINTS = {
  file_read: ['Prefer targeted reads when task context is available'],
  file_patch: ['Validate against active rules before applying changes'],
  shell_run: ['Apply safety constraints from memory and rules']
};

export async function PlannerStage(ctx, next) {
  const toolName = ctx.toolRequest?.name || null;
  const rules = ctx.rules || [];
  const skills = ctx.skills || [];
  const retrievedMemory = ctx.retrievedMemory || [];
  const skillNames = skills.map((skill) => skill.name || skill);

  const plan = {
    tool: toolName,
    strategy: 'direct',
    hints: [],
    capabilitiesUsed: {
      rules: rules.map((rule) => rule.name),
      skills: skillNames,
      memory: retrievedMemory.map((entry) => entry.key)
    },
    shouldProceed: true
  };

  if (toolName && TOOL_CAPABILITY_HINTS[toolName]) {
    plan.hints.push(...TOOL_CAPABILITY_HINTS[toolName]);
  }

  if (retrievedMemory.some((entry) => entry.type === 'preference')) {
    plan.hints.push('Apply user preferences from retrieved memory');
    plan.strategy = 'capability-aware';
  }

  if (skillNames.includes('debug-skill') && ['file_read', 'file_patch'].includes(toolName)) {
    plan.hints.push('Debug skill active: include detailed context in responses');
    plan.strategy = 'capability-aware';
  }

  if (rules.some((rule) => rule.name === 'global_rules')) {
    plan.hints.push('Global rules are active for this execution');
  }

  if (!toolName) {
    plan.strategy = 'observe';
    plan.shouldProceed = false;
    plan.hints.push('No tool requested; planner generated capability context only');
  }

  ctx.executionPlan = plan;
  ctx.planner = plan;
  ctx.session = ctx.session || {};
  ctx.session.executionPlan = plan;
  return next();
}

export default PlannerStage;
