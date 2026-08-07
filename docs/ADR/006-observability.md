# ADR-006: Observability（Trace / Timeline / Metrics / ExecutionRecorder）

> Status: **Accepted** · Phase 6 (Observability) 产出
> Date: 2026-08-05

## Context

Runtime 需要可观测、可调试、可回放。review_gpt_base2.1 + step_v3_plan_review
最强调 ExecutionRecorder：否则 Replay 只能重放 Tool，不能重放 LLM。

## Decision

### P6-1 Trace（全链路 span）
基于 EventBus + lifecycle hooks，建立 Request → Task → Stage → Tool → Artifact
的 trace span。`Trace.start()/end()` 维护父子层级与 durationMs，闭合后经
EventBus `TraceSpan` 事件广播给 Observers。

### P6-2 Timeline（时间线）
记录 Planning / Search / Review / Report 各阶段的时间顺序条目，
便于 Debug 操作次序。支持 `withPhase()` 自动记录 start/end 标记。

### P6-3 Metrics（量化指标）
统计 Latency / Tool Time / Memory Hit / Context Size / Retry / Failure /
Confidence，提供全局聚合快照（min/avg/max/count）。

### P6-4 ExecutionRecorder ⭐
记录 Prompt → Context → Planner → Tool → Artifact → Response 完整执行链，
为真正的 Replay / Debug 提供数据源。`recordFromContext(ctx)` 从 RuntimeContext
一键捕获全链路。

### ObservabilityManager（统一门面）
聚合 Trace / Timeline / Metrics / ExecutionRecorder，`recordRequest(ctx)`
记录一次完整请求生命周期并闭合顶层 span。

## Consequences

- 全链路可观测、可调试；ExecutionRecorder 为 Replay/Benchmark 提供数据源。
- 所有收集器经 EventBus 广播，Observers（Memory/Telemetry/Log/UI）无需耦合。
- Phase 5 Multi-Agent / Knowledge Index Embedding 可在同一观测面上扩展。

## References

- `src/runtime/observability/*.js`
- `tests/unit/runtime.observability.test.js`
