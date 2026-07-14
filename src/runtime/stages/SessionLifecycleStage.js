import { ConversationLoadStage } from './ConversationLoadStage.js';
import { TaskPolicyStage } from './TaskPolicyStage.js';
import { SummaryStage } from './SummaryStage.js';
import { SnapshotStage } from './SnapshotStage.js';
import { SessionStatePolicyStage } from './SessionStatePolicyStage.js';

export async function SessionLifecycleStage(ctx, next) {
  return ConversationLoadStage(ctx, async () => {
    return TaskPolicyStage(ctx, async () => {
      return SummaryStage(ctx, async () => {
        return SnapshotStage(ctx, async () => {
          return SessionStatePolicyStage(ctx, next);
        });
      });
    });
  });
}

export default SessionLifecycleStage;
