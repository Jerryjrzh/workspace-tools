// src/runtime/stages/WorkspaceStage.js
import { RuntimeContextStage } from './RuntimeContextStage.js';

/**
 * WorkspaceStage - ONLY resolve workspace path
 *
 * This stage now delegates to the runtime context provider chain.
 */
export async function WorkspaceStage(ctx, next) {
  return RuntimeContextStage(ctx, next);
}
