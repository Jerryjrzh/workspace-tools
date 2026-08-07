# ADR-005: Artifact Workspace（Artifact Version / KnowledgeProvider）

> Status: **Accepted** · Phase 4 (Artifact Workspace) 产出
> Date: 2026-08-05

## Context

Context → Artifact，解决长上下文与代码审查稳定性。review_gpt_base2.1 +
step_v3_plan_review 强调：Embedding 模型常换，Framework 不应绑定；只定义抽象接口。

## Decision

### P4-1 ArtifactManager + Artifact Version
统一 Markdown / JSON / PDF / Image / Code / Diagram 为 `Artifact` class，
提供 `create()/read()/update()/delete()` + 元数据（type/tags/source）。
**新增 Artifact Version**：analysis.md → v1/v2/v3，支持 Compare / Rollback /
History。持久化到 `.lmstudio-artifacts/*.json`。

### P4-2 Workspace Graph
新建 `DependencyGraph`：Artifact → Dependency（review.md 引用 analysis.md →
source.cpp）。Runtime 可追踪 artifact 依赖，供增量分析。

### P4-3 Incremental Review
`IncrementalReview`：Modified Files → Affected Artifacts → diff review +
impact analysis。支持 `computeScope()` / `review()` 产出直接受影响与传递影响集合。

### P4-5 KnowledgeProvider（抽象接口先行）⭐
新建 `KnowledgeProvider` 抽象接口（tag/dependency/reference），并提供内存实现
`MemoryKnowledgeProvider`。
**Embedding 推迟到 Phase6**：避免模型更换导致返工，Framework 不绑定具体 embedding。

## Consequences

- Context → Artifact，支持历史 / Diff / 回滚。
- 增量审查 + 依赖追踪，代码审查稳定性提升。
- KnowledgeProvider 抽象先行，Phase6 可替换 embedding 实现而不改 Framework。

## References

- `src/runtime/artifacts/*.js`
- `tests/unit/runtime.artifacts.test.js`
