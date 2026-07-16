import { WorkspaceStage } from './stages/WorkspaceStage.js';
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
import { CapabilityContextStage } from './stages/CapabilityContextStage.js';
import { PlannerStage } from './stages/PlannerStage.js';
import { GuardStage } from './stages/GuardStage.js';

export const runtimeFramework = {
  name: 'workspace-tools-runtime',
  version: 'v2.1',
  stages: [
    WorkspaceStage,
    RuntimeContextStage,
    SessionRecoveryStage,
    WorkspacePolicyStage,
    PathPolicyStage,
    BackupPolicyStage,
    RuleStage,
    SkillStage,
    MemoryStage,
    MemoryExtractStage,
    MemoryRetrieveStage,
    CapabilityContextStage,
    PlannerStage,
    GuardStage
  ]
};

export function applyRuntimeFramework(runtime) {
  for (const stage of runtimeFramework.stages) {
    runtime.use(stage);
  }
  return runtime;
}

export default runtimeFramework;
