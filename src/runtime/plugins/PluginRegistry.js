// src/runtime/plugins/PluginRegistry.js
import { eventBus } from '../EventBus.js';

/**
 * Plugin Registry - extension point for Tool / Stage / Policy registration.
 *
 * Per docs/CONTEXT_CONTRACT.md §8, plugins register here instead of growing the
 * Dispatcher. This keeps the core runtime small and composable.
 */
export class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    // Extension buckets: tools override/extend toolHandlers; stages extend pipeline;
    // policies extend guard policy engine.
    this.extensions = {
      tools: {},
      stages: [],
      policies: []
    };
  }

  /**
   * Register a plugin module.
   * @param {Object} plugin - { name, version, register(runtime) }
   */
  async register(plugin) {
    if (!plugin || typeof plugin.register !== 'function') {
      throw new Error('[PluginRegistry] Plugin must expose a register() method');
    }

    const existing = this.plugins.get(plugin.name);
    if (existing && existing.version === plugin.version) {
      return false; // already registered
    }

    await plugin.register(this);
    this.plugins.set(plugin.name, { ...plugin, installedAt: Date.now() });
    eventBus.emitDomain('PluginInstalled', { name: plugin.name, version: plugin.version });
    return true;
  }

  /**
   * Register a tool handler extension.
   */
  registerTool(name, handler) {
    this.extensions.tools[name] = handler;
    return this;
  }

  /**
   * Register an extra stage (appended to the pipeline).
   */
  registerStage(stage) {
    this.extensions.stages.push(stage);
    return this;
  }

  /**
   * Register a policy.
   */
  registerPolicy(policy) {
    this.extensions.policies.push(policy);
    return this;
  }

  /** Collect all registered tool extensions. */
  getToolExtensions() {
    return { ...this.extensions.tools };
  }

  /** Collect all extra stages. */
  getStageExtensions() {
    return [...this.extensions.stages];
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      version: p.version,
      installedAt: p.installedAt
    }));
  }
}

export const pluginRegistry = new PluginRegistry();
export default PluginRegistry;
