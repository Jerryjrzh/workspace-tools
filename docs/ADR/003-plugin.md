# ADR-003: Plugin & 能力扩展机制

> Status: **Accepted** · Phase 3 (Workflow Engine) 产出
> Date: 2026-08-05

## Context

Runtime 需要在不侵入核心引擎的前提下扩展工具、stage、policy。PluginRegistry /
Capability / Provider 提供了统一挂载点。

## Decision

1. **PluginRegistry 注册 tools/stages/policies**：插件可声明工具、中间件 stage、
   策略，并支持列出已注册插件。
2. **Provider 抽象接口**（watch/dispose lifecycle）：Memory/Conversation/Rule/
   SessionState/SessionWorkspace/RuntimeContext 等以 Provider 形式接入
   ProviderRegistry，避免直接耦合 runtime 内部。
3. **Capability 检测**：`detectCapabilities()` 报告可用系统二进制能力，
   供 Planner / Guard 决策。

## Consequences

- 新增工具/策略无需改动核心引擎文件。
- Observers（Memory/Telemetry/Log/Plugin/UI/Streaming）通过 EventBus 订阅
  领域事件，而非互相直接调用。
- Phase 4 KnowledgeProvider 将沿用同一抽象接口模式（tag/dependency/reference）。

## References

- `src/runtime/plugins/PluginRegistry.js`
- `src/runtime/providers/*.js` · `src/runtime/capabilities.js`
