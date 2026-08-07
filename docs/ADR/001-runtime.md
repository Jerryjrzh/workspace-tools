# ADR-001: Runtime Architecture

> Status: **Accepted** · Phase 3 (Workflow Engine) 产出
> Date: 2026-08-05

## Context

基础框架已成型（Lifecycle + Context Contract、ToolResult/Provider/EventBus/
Capability/Plugin、stage 接线）。Runtime 需要从 Request Engine 升级为可承载
多状态长任务的 Workflow Engine，同时保持现有单工具路径稳定。

## Decision

1. **AgentRuntime 作为核心引擎**：以 `initialize → beforeRequest →
   buildContext → execute → afterExecute → persist → cleanup` 生命周期契约驱动，
   每个阶段均可覆写（Streaming / Multi-Agent / Background Task）。
2. **Stage Pipeline 中间件模型**：stage 为 `async (ctx, next) => {}`，通过
   `runtime.use(stage)` 注册；核心框架 stages 保持默认启用。
3. **Workflow stages 可选接线**（`applyWorkflowFramework()`）：Planning →
   Execution → Validation → Review → Finalize 作为独立数组追加在核心框架之后，
   默认不启用，避免破坏单工具路径。
4. **Task 对象模型 + State Machine**：统一 `id/goal/state/context/artifacts/
   checkpoints/result/trace` + `metadata`（priority/owner/capabilities/labels/
   confidence），供 Planner/Review/Trace 复用。

## Consequences

- Runtime 可表达多状态长任务，且流程由 WorkflowDefinition 配置驱动而非硬编码。
- 现有单工具路径不受影响（workflow stages 默认关闭）。
- 后续 Phase 6 Observability / Phase 5 Multi-Agent 可在同一生命周期上扩展。

## References

- `docs/CONTEXT_CONTRACT.md`
- `src/runtime/AgentRuntime.js` · `src/runtime/framework.js`
