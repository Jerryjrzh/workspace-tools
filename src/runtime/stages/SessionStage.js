import { SessionLifecycleStage } from './SessionLifecycleStage.js';

export async function SessionStage(ctx, next) {
  return SessionLifecycleStage(ctx, next);
}
