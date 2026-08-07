# ADR-004: Workflow Engine（Execution Policy / Workflow Definition）

> Status: **Accepted** · Phase 3 (Workflow Engine) 产出
> Date: 2026-08-05

## Context

review_gpt_base2.1 + step_v3_plan_review 最强调的两项补充：控制 Workflow 如何运行，
且让流程配置化而非写死。Runtime 不应以 `new PlanningStage()` 硬编码流程。

## Decision

### Task 对象模型（P3-1）
统一 `Task` class，字段 `id/goal/state/context/artifacts/checkpoints/result/trace`
+ **metadata**（priority/owner/createdAt/updatedAt/runtimeVersion/capabilities/
labels/confidence）。状态机：
```
Created → Planning → Ready → Executing ⇄ Waiting
                                    ↓
                              Reviewing → Completed → Archived
```
支持 `retry() / resume() / cancel() / rollback()` 转换方法。

### TaskManager + Repository（P3-2）
`TaskManager` 创建/加载/更新/归档，内部持有 `TaskRepository`，持久化到
`.lmstudio-task-checkpoints/*.json`（复用现有 task.js 目录约定）。

### CheckpointManager（P3-3）
`save() / restore() / rollback() / resume()`，接入 Task.state，长任务可恢复/回滚。

### Workflow Pipeline stages（P3-4）
新增 `PlanningStage / ExecutionStage / ValidationStage / ReviewStage /
FinalizeStage`。在 framework.js 接线为**可选 workflow stages**（默认不启用，
避免破坏现有单工具路径）。

### ExecutionPolicy + PolicyManager + WorkflowDefinition（P3-6）⭐
- **ExecutionPolicy**：声明式规则控制 Retry / Timeout / Parallel / MaxDepth /
  Checkpoint Frequency / Auto Review / Manual Review。
- **PolicyManager**：按名称注册/解析 policy 与 workflow，运行时读取配置而非硬编码。
- **WorkflowDefinition**：以 JSON/YAML 定义流程（planning→execution→validation→
  review→finalize），Runtime 通过 `WorkflowEngine.build(def)` 解析为 stage 函数，
  对齐 LangGraph/AutoGen 的"流程由定义驱动"。

## Consequences

- 流程配置化，新增/调整 workflow 无需改代码。
- Task 可持久化、恢复、回滚，支持多状态长任务。
- ExecutionPolicy 提供统一的运行控制面（重试/超时/并行/检查点频率）。
- 现有单工具路径不受影响。

## References

- `src/runtime/tasks/*.js` · `src/runtime/workflows/*.js`
- `tests/unit/task.state-machine.test.js` · `task.execution-policy.test.js`
