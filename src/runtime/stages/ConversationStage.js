import { RuntimeContextStage } from './RuntimeContextStage.js';

export async function ConversationStage(ctx, next) {
  return RuntimeContextStage(ctx, next);
}
