# ADR-002: Context Contract & 上下文抑制

> Status: **Accepted** · Phase 3 (Workflow Engine) 产出
> Date: 2026-08-05

## Context

Context 是贯穿 stage pipeline 的唯一事实来源。长会话下消息与 memory 会持续增长，
需要统一的契约形状 + 抑制策略，避免上下文爆炸。

## Decision

1. **RuntimeContext 单一事实来源**：所有 stages / tools / planners 依赖同一 shape
   （sessionId/task/workspace/conversation/rules/skills/memory/promptContext/
   executionPlan/toolRequest/state/result/lifecycle）。新字段集中在 `AgentRuntime.js`
   一处添加。
2. **抑制顺序**：`WorkspaceStage → RuntimeContextStage → ContextBudgetStage →
   SessionRecoveryStage ...`，conversation 在 RuntimeContextStage 加载完成后，
   ContextBudgetStage 才能读到真实消息并执行上下文增长抑制。
3. **Memory 全局上限**：memory maxEntries / maxEntryChars 约束条目规模；
   检索结果经 MemoryRetrieveStage 注入 retrievedMemory。

## Consequences

- 各阶段共享同一契约，新增能力无需散落多处修改。
- 长会话上下文受控，避免 ContextBudget 失效。
- Task.context 挂载 artifacts 引用（planning.md/analysis.md/review.md/
   report.md/summary.md），Memory 只存索引。

## References

- `docs/CONTEXT_CONTRACT.md`
- `src/runtime/stages/ContextBudgetStage.js` · `RuntimeContextStage.js`
