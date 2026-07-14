import fs from 'fs';
import path from 'path';

export async function SkillStage(ctx, next) {
  const workspace = ctx.workspace || null;
  const skillFile = workspace ? path.join(workspace, '.agent-skills.json') : null;

  let skills = [];
  if (skillFile && fs.existsSync(skillFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(skillFile, 'utf8'));
      skills = Array.isArray(parsed) ? parsed : [];
    } catch {
      skills = [];
    }
  }

  ctx.skills = skills;
  ctx.session = ctx.session || {};
  ctx.session.skills = skills;
  return next();
}
