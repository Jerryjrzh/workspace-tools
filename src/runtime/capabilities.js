// src/runtime/capabilities.js
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Detect real system capabilities available to the runtime.
 *
 * Per docs/CONTEXT_CONTRACT.md §7, the Runtime collects these at startup and
 * injects them into ctx.capabilities. The Planner uses this to decide whether a
 * tool can run — avoiding unbounded prompt growth from listing every capability.
 */
export function detectCapabilities(workspace = null) {
  return {
    shell: commandExists('bash') || commandExists('sh'),
    git: commandExists('git'),
    docker: commandExists('docker'),
    python: commandExists('python3') || commandExists('python'),
    node: commandExists('node'),
    ssh: commandExists('ssh'),
    workspace: Boolean(workspace && fs.existsSync(path.resolve(workspace))),
    timestamp: Date.now()
  };
}

/**
 * Check whether a binary exists on PATH.
 */
export function commandExists(binary) {
  try {
    const result = spawnSync('which', [binary], { encoding: 'utf8' });
    return result.status === 0 && Boolean(result.stdout.trim());
  } catch (_err) {
    return false;
  }
}

/**
 * Build a compact capability summary string for prompt injection.
 */
export function summarizeCapabilities(caps) {
  const active = Object.entries(caps)
    .filter(([key, value]) => key !== 'timestamp' && Boolean(value))
    .map(([key]) => key);
  return active.join(',') || 'none';
}

export default { detectCapabilities, commandExists, summarizeCapabilities };
