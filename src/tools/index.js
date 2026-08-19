// 工具注册表入口（Lazy Loading）
//
// ⚠️ 懒加载：本文件不再静态 import 任何工具模块。所有工具定义与 handler
//    均通过 registry.loadModule() / getToolHandler() 在使用时动态 import。
//    - ListTools 广告面由 groups.listEnabledTools() 按启用组按需展开
//    - 调用路由由 runtime/toolRouter.js → registry.getToolHandler() 自动加载
//
// 向后兼容导出（供 server.js / 测试使用）：
//   TOOL_GROUPS, DEFAULT_GROUPS, resolveEnabledGroups,
//   listEnabledTools(async), isToolEnabled

export {
  TOOL_GROUPS,
  DEFAULT_GROUPS,
  resolveEnabledGroups,
  normalizeGroupList,
  listEnabledTools,
  isToolEnabled
} from './groups.js';

// 懒加载注册表（静态元数据 + 动态 import）
export { TOOL_TO_MODULE, MODULES, GROUP_MODULES } from './registry.js';

// Model-driven discovery：能力发现 / promote / capability set
export {
  DISCOVERABLE_TOOLS,
  CapabilityRegistry,
  ToolCapabilitySet,
  capabilitySet,
  discover,
  promoteTool,
  isDiscoverable
} from './discovery.js';
