export function buildPromptContext(ctx) {
  const rules = ctx.rules || [];
  const taskRules = ctx.taskRules || [];
  const skills = ctx.skills || [];
  const memories = ctx.retrievedMemory || [];
  const identityMemory = ctx.memoryBackground?.identity || [];
  const soulMemory = ctx.memoryBackground?.soul || [];
  const recentActivity = ctx.memoryBackground?.recentActivity || [];
  const workingMemory = ctx.retrievedWorkingMemory || [];

  const sections = [];

  if (rules.length > 0) {
    sections.push({
      name: 'Agent Rules',
      tag: 'rules',
      content: rules.map((rule) => `### ${rule.name}\n${rule.content}`).join('\n\n')
    });
  }

  if (taskRules.length > 0) {
    sections.push({
      name: 'Task Bootstrap Rules',
      tag: 'task-rules',
      content: taskRules.map((rule) => `### ${rule.name}\n${rule.path}`).join('\n\n')
    });
  }

  if (skills.length > 0) {
    sections.push({
      name: 'Agent Skills',
      tag: 'skills',
      content: skills
        .map((skill) => {
          const name = skill.name || skill;
          const description = skill.description ? `: ${skill.description}` : '';
          return `- ${name}${description}`;
        })
        .join('\n')
    });
  }

  if (identityMemory.length > 0) {
    sections.push({
      name: 'Identity Memory',
      tag: 'identity-memory',
      content: identityMemory.map((entry) => `- ${entry.value}`).join('\n')
    });
  }

  if (soulMemory.length > 0) {
    sections.push({
      name: 'Soul Memory',
      tag: 'soul-memory',
      content: soulMemory.map((entry) => `- ${entry.value}`).join('\n')
    });
  }

  if (memories.length > 0) {
    sections.push({
      name: 'User Memory',
      tag: 'memory',
      content: memories.map((entry) => `- [${entry.type || 'fact'}] ${entry.value}`).join('\n')
    });
  }

  if (workingMemory.length > 0) {
    sections.push({
      name: 'Working Memory',
      tag: 'working-memory',
      content: workingMemory.map((entry) => `- [${entry.type || 'fact'}] ${entry.value}`).join('\n')
    });
  }

  if (recentActivity.length > 0) {
    sections.push({
      name: 'Recent Activity',
      tag: 'recent-activity',
      content: recentActivity.map((entry) => `- ${entry.type || 'activity'}: ${entry.summary || entry.value || ''}`).join('\n')
    });
  }

  const systemPrompt = sections
    .map((section) => `<${section.tag}>\n${section.content}\n</${section.tag}>`)
    .join('\n\n') || '<bootstrap>session_start:compatible</bootstrap>';

  return {
    sections,
    systemPrompt,
    hasContent: sections.length > 0
  };
}

export default buildPromptContext;
