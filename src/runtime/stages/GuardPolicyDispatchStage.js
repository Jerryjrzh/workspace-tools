import { PolicyEngine } from '../policies/PolicyEngine.js';
import { WorkspacePolicyStage } from './WorkspacePolicyStage.js';
import { PathPolicyStage } from './PathPolicyStage.js';
import { BackupPolicyStage } from './BackupPolicyStage.js';
import { PermissionPolicyStage } from './PermissionPolicyStage.js';
import { SyntaxPolicyStage } from './SyntaxPolicyStage.js';

export async function GuardPolicyDispatchStage(ctx, next) {
  const engine = ctx.policyEngine || new PolicyEngine([
    WorkspacePolicyStage,
    PathPolicyStage,
    PermissionPolicyStage,
    SyntaxPolicyStage,
    BackupPolicyStage
  ]);

  return engine.run(ctx, next);
}

export default GuardPolicyDispatchStage;
