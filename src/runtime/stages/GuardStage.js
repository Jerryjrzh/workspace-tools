import { GuardPolicyDispatchStage } from './GuardPolicyDispatchStage.js';

export async function GuardStage(ctx, next) {
  return GuardPolicyDispatchStage(ctx, next);
}
