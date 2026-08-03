import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GuardStage } from '../../src/runtime/stages/GuardStage.js';
import { WorkspacePolicyStage } from '../../src/runtime/stages/WorkspacePolicyStage.js';
import { PathPolicyStage } from '../../src/runtime/stages/PathPolicyStage.js';
import { BackupPolicyStage } from '../../src/runtime/stages/BackupPolicyStage.js';
import { PermissionPolicyStage } from '../../src/runtime/stages/PermissionPolicyStage.js';
import { SyntaxPolicyStage } from '../../src/runtime/stages/SyntaxPolicyStage.js';
import { PolicyEngine } from '../../src/runtime/policies/PolicyEngine.js';

function createTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-guard-'));
  const workspace = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  return { tempDir, workspace };
}

test('GuardStage creates a backup for write-like tools inside workspace', async () => {
  const { workspace, tempDir } = createTempWorkspace();
  const targetFile = path.join(workspace, 'hello.txt');
  fs.writeFileSync(targetFile, 'hello\nworld\n', 'utf8');

  const ctx = {
    workspace,
    toolRequest: { name: 'file_patch', args: { path: 'hello.txt' } },
    state: {}
  };

  let called = false;
  await GuardStage(ctx, async () => {
    called = true;
  });

  assert.equal(called, true);
  assert.ok(ctx.state.guardBackups);
  assert.equal(ctx.state.guardBackups.length, 1);
  assert.ok(fs.existsSync(ctx.state.guardBackups[0]));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('GuardStage rejects path traversal outside workspace', async () => {
  const { workspace, tempDir } = createTempWorkspace();
  const ctx = {
    workspace,
    toolRequest: { name: 'file_patch', args: { path: '../outside.txt' } },
    state: {}
  };

  await assert.rejects(
    GuardStage(ctx, async () => {}),
    /越权访问/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('policy stages enforce workspace, path, and backup rules independently', async () => {
  const { workspace, tempDir } = createTempWorkspace();
  const targetFile = path.join(workspace, 'hello.txt');
  fs.writeFileSync(targetFile, 'hello\nworld\n', 'utf8');

  const ctx = {
    workspace,
    toolRequest: { name: 'file_patch', args: { path: 'hello.txt' } },
    state: {}
  };

  await assert.rejects(
    WorkspacePolicyStage({ toolRequest: { name: 'file_patch', args: { path: 'hello.txt' } } }, async () => {}),
    /Workspace not set/
  );

  await assert.doesNotReject(() => PathPolicyStage(ctx, async () => {}));
  await assert.doesNotReject(() => BackupPolicyStage(ctx, async () => {}));

  assert.ok(ctx.state.guardBackups);
  assert.equal(ctx.state.guardBackups.length, 1);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('permission and syntax policies reject unsafe write requests', async () => {
  const { workspace, tempDir } = createTempWorkspace();
  const targetFile = path.join(workspace, 'greet.js');
  fs.writeFileSync(targetFile, 'console.log("ok")\n', 'utf8');

  const permissionCtx = {
    workspace,
    toolRequest: { name: 'file_write', args: { path: 'greet.js', permission: 'deny' } },
    state: {}
  };

  await assert.rejects(
    PermissionPolicyStage(permissionCtx, async () => {}),
    /Permission denied/
  );

  const syntaxCtx = {
    workspace,
    toolRequest: { name: 'file_write', args: { path: 'greet.js', content: 'function broken( { return 1;' } },
    state: { absolutePath: targetFile }
  };

  await assert.rejects(
    SyntaxPolicyStage(syntaxCtx, async () => {}),
    /Syntax check failed/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('GuardStage accepts a custom policy engine for runtime dispatch', async () => {
  const { workspace, tempDir } = createTempWorkspace();
  const ctx = {
    workspace,
    toolRequest: { name: 'file_patch', args: { path: 'hello.txt' } },
    state: {},
    policyEngine: new PolicyEngine([
      async (currentCtx, next) => {
        currentCtx.state.customPolicyRan = true;
        return next();
      }
    ])
  };

  let called = false;
  await GuardStage(ctx, async () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(ctx.state.customPolicyRan, true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
