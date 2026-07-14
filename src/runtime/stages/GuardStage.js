import { WorkspacePolicyStage } from './WorkspacePolicyStage.js';
import { PathPolicyStage } from './PathPolicyStage.js';
import { BackupPolicyStage } from './BackupPolicyStage.js';
import { PermissionPolicyStage } from './PermissionPolicyStage.js';
import { SyntaxPolicyStage } from './SyntaxPolicyStage.js';

export async function GuardStage(ctx, next) {
  await WorkspacePolicyStage(ctx, async () => {
    return PathPolicyStage(ctx, async () => {
      return PermissionPolicyStage(ctx, async () => {
        return SyntaxPolicyStage(ctx, async () => {
          return BackupPolicyStage(ctx, next);
        });
      });
    });
  });
}
