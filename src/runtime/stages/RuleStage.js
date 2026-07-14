import { ruleManager } from '../../managers/rules.js';

export async function RuleStage(ctx, next) {
  const workspace = ctx.workspace || null;
  const task = ctx.task || ctx.session?.task || ctx.toolRequest?.task || null;

  const rules = [];
  const globalRules = ruleManager.loadGlobal();
  if (globalRules) {
    rules.push({ name: 'global_rules', content: globalRules });
  }

  if (workspace) {
    const projectRules = ruleManager.loadProject(workspace);
    if (projectRules) {
      rules.push({ name: 'project_rules', content: projectRules });
    }
  }

  if (task) {
    try {
      const taskRules = ruleManager.loadTask(task);
      rules.push({ name: `task_rules:${String(task).toLowerCase()}`, content: taskRules });
    } catch {
      // ignore missing task rules
    }
  }

  ctx.rules = rules;
  ctx.session = ctx.session || {};
  ctx.session.rules = rules;
  return next();
}
