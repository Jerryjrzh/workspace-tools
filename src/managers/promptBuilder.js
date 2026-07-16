export function buildPromptContext(ctx) {
  const rules = ctx.rules || [];
  const skills = ctx.skills || [];
  const memories = ctx.retrievedMemory || [];

  const sections = [];

  if (rules.length > 0) {
    sections.push({
      name: 'Agent Rules',
      tag: 'rules',
      content: rules.map((rule) => `### ${rule.name}\n${rule.content}`).join('\n\n')
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

  if (memories.length > 0) {
    sections.push({
      name: 'User Memory',
      tag: 'memory',
      content: memories.map((entry) => `- [${entry.type || 'fact'}] ${entry.value}`).join('\n')
    });
  }

  const systemPrompt = sections
    .map((section) => `<${section.tag}>\n${section.content}\n</${section.tag}>`)
    .join('\n\n');

  return {
    sections,
    systemPrompt,
    hasContent: sections.length > 0
  };
}

export default buildPromptContext;
