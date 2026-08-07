import { WorkspaceStage } from './stages/WorkspaceStage.js';
import { ContextBudgetStage } from './stages/ContextBudgetStage.js';
import { RuntimeContextStage } from './stages/RuntimeContextStage.js';
import { SessionRecoveryStage } from './stages/SessionRecoveryStage.js';
import { WorkspacePolicyStage } from './stages/WorkspacePolicyStage.js';
import { PathPolicyStage } from './stages/PathPolicyStage.js';
import { BackupPolicyStage } from './stages/BackupPolicyStage.js';
import { RuleStage } from './stages/RuleStage.js';
import { SkillStage } from './stages/SkillStage.js';
import { MemoryStage } from './stages/MemoryStage.js';
import { MemoryExtractStage } from './stages/MemoryExtractStage.js';
import { MemoryRetrieveStage } from './stages/MemoryRetrieveStage.js';
import { IdentityRetrieveStage } from './stages/IdentityRetrieveStage.js';
import { SoulRetrieveStage } from './stages/SoulRetrieveStage.js';
import { BackgroundContextStage } from './stages/BackgroundContextStage.js';
import { CapabilityContextStage } from './stages/CapabilityContextStage.js';
import { PlannerStage } from './stages/PlannerStage.js';
import { GuardStage } from './stages/GuardStage.js';
import { SyntaxPolicyStage } from './stages/SyntaxPolicyStage.js';
import { PermissionPolicyStage } from './stages/PermissionPolicyStage.js';
// Optional workflow pipeline stages (Phase 3). Not enabled by default to avoid
// breaking the existing single-tool path — wire via applyWorkflowFramework().
import { PlanningStage } from './workflows/PlanningStage.js';
import { ExecutionStage } from './workflows/ExecutionStage.js';
import { ValidationStage } from './workflows/ValidationStage.js';
import { ReviewStage } from './workflows/ReviewStage.js';
import { FinalizeStage } from './workflows/FinalizeStage.js';

export const runtimeFramework = {
  name: 'workspace-tools-runtime',
  version: 'v2.1',
  stages: [
    WorkspaceStage,
    RuntimeContextStage,
    // conversation 在 RuntimeContextStage 中加载，因此抑制必须在其之后才能读到真实消息
    ContextBudgetStage,
    SessionRecoveryStage,
    WorkspacePolicyStage,
    PathPolicyStage,
    BackupPolicyStage,
    RuleStage,
    SkillStage,
    MemoryStage,
    MemoryExtractStage,
    MemoryRetrieveStage,
    IdentityRetrieveStage,
    SoulRetrieveStage,
    BackgroundContextStage,
    CapabilityContextStage,
    PlannerStage,
    // 写操作守卫：在工具执行前校验语法与权限
    SyntaxPolicyStage,
    PermissionPolicyStage,
    GuardStage
  ]
};

/**
 * Optional workflow pipeline stages (Phase 3). Kept separate from
 * `runtimeFramework.stages` so existing single-tool paths are unaffected.
 */
export const workflowStages = [
  PlanningStage,
  ExecutionStage,
  ValidationStage,
  ReviewStage,
  FinalizeStage
];

export function applyRuntimeFramework(runtime) {
  for (const stage of runtimeFramework.stages) {
    runtime.use(stage);
  }
  return runtime;
}

/**
 * Opt-in wiring for the workflow pipeline. Appends the Phase 3 stages AFTER the
 * core framework so a Task object can flow through Planning → Execution →
 * Validation → Review → Finalize.
 */
export function applyWorkflowFramework(runtime) {
  for (const stage of workflowStages) {
    runtime.use(stage);
  }
  return runtime;
}

export default runtimeFramework;