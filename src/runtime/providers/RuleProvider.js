import { ruleManager } from '../../managers/rules.js';
import { Provider } from './Provider.js';

/**
 * RuleProvider - unified interface over the legacy RuleManager.
 *
 * Implements load/save/watch/dispose per docs/CONTEXT_CONTRACT.md §5 so rules
 * can be swapped to SQLite/Redis backends without changing stage code.
 */
export class RuleProvider extends Provider {
  constructor(manager = ruleManager) {
    super();
    this.manager = manager;
  }

  /**
   * Load structured rules for a session (global + task).
   * @param {string} _sessionId - reserved; rules are workspace/task scoped
   */
  async load(_sessionId, options = {}) {
    const globalRules = await this.manager.loadGlobalRules();
    let projectRules = [];
    if (options?.workspace) {
      const content = this.manager.loadProject(options.workspace);
      if (content) {
        projectRules.push({ name: 'project_rules', path: options.workspace, content });
      }
    }

    let taskRules = [];
    if (options?.task) {
      try {
        const content = this.manager.loadTask(options.task);
        taskRules.push({
          name: `task_rules:${String(options.task).toLowerCase()}`,
          path: options.task,
          content
        });
      } catch (_err) {
        // missing task rules are ignored
      }
    }

    return [...globalRules, ...projectRules, ...taskRules];
  }

  async save(_sessionId, _data) {
    // Rules are read-only from the runtime's perspective; persistence is managed
    // by file authoring tools. Return a no-op for interface uniformity.
    return null;
  }
}

export const ruleProvider = new RuleProvider();
export default RuleProvider;
