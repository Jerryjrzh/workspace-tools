// src/managers/rules.js
import fs from 'fs';
import path from 'path';
import os from 'os';

class RuleManager {
  constructor() {
    this.rulesDir = path.join(os.homedir(), '.lmstudio', 'tasks');
    this.globalRulePath = path.join(os.homedir(), '.lmstudio', 'global_rules.md');
  }

  loadGlobal() {
    if (fs.existsSync(this.globalRulePath)) {
      return fs.readFileSync(this.globalRulePath, 'utf8');
    }
    return '⚠️ Global rules not found';
  }

  loadTask(taskName) {
    const filePath = path.join(this.rulesDir, `${taskName}.md`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    throw new Error(`Task rules file not found: ${filePath}`);
  }

  // For future extension
  loadProject(workspacePath) {
    const projectRulesPath = path.join(workspacePath, '.agent-rules.md');
    if (fs.existsSync(projectRulesPath)) {
      return fs.readFileSync(projectRulesPath, 'utf8');
    }
    return '';
  }

  /**
   * Load global rules and return as structured data
   */
  async loadGlobalRules() {
    const content = this.loadGlobal();
    return [
      {
        name: 'global_rules',
        path: this.globalRulePath,
        content: content
      }
    ];
  }
}

export const ruleManager = new RuleManager();