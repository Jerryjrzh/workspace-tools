import { conversationProvider } from '../providers/ConversationProvider.js';
import { TaskPolicyStage } from './TaskPolicyStage.js';
import { SummaryStage } from './SummaryStage.js';
import { SnapshotStage } from './SnapshotStage.js';
import { SessionStatePolicyStage } from './SessionStatePolicyStage.js';

export async function SessionStage(ctx, next) {
  const sessionId = ctx.sessionId || ctx.toolRequest?.conversationId || null;
  if (!sessionId) {
    return next();
  }

  const conversation = conversationProvider.load(sessionId) || {
    name: 'Unknown',
    messages: []
  };

  ctx.conversation = conversation;
  ctx.session = ctx.session || {};
  ctx.session.conversation = conversation;
  ctx.session.id = sessionId;
  ctx.session.workspace = ctx.workspace || ctx.session.workspace || null;

  await TaskPolicyStage(ctx, async () => {
    return SummaryStage(ctx, async () => {
      return SnapshotStage(ctx, async () => {
        return SessionStatePolicyStage(ctx, next);
      });
    });
  });
}
