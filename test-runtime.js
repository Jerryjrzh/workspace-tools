// test-runtime.js - Simple test for V2.1 Runtime
import { AgentRuntime } from './src/runtime/AgentRuntime.js';
import { WorkspaceStage } from './src/runtime/stages/WorkspaceStage.js';
import { GuardStage } from './src/runtime/stages/GuardStage.js';
import { file_read } from './src/tools/file_read.js';

async function testBasicRuntime() {
  console.log('=== Testing Basic Runtime ===\n');
  
  // Create runtime
  const runtime = new AgentRuntime();
  runtime.use(WorkspaceStage);
  runtime.use(GuardStage);
  
  // Add file_read as final stage
  runtime.use(async (ctx, next) => {
    ctx.result = await file_read(ctx, ctx.toolRequest.args);
  });
  
  // Get test workspace
  const workspace = process.cwd();
  console.log(`Test workspace: ${workspace}`);
  
  // Test file_read
  const initialData = {
    toolRequest: {
      name: 'file_read',
      args: { path: 'package.json' },
      conversationId: 'test'
    },
    workspace: workspace
  };
  
  try {
    const result = await runtime.execute(initialData);
    console.log('✅ file_read passed');
    console.log(`Result length: ${typeof result === 'string' ? result.length : 'object'}`);
  } catch (error) {
    console.log('❌ file_read failed:', error.message);
  }
  
  console.log('');
}

async function testWorkspaceStage() {
  console.log('=== Testing WorkspaceStage ===\n');
  
  const runtime = new AgentRuntime();
  runtime.use(WorkspaceStage);
  
  // Check workspace resolution
  let workspaceSet = false;
  runtime.use(async (ctx, next) => {
    workspaceSet = !!ctx.workspace;
    console.log(`Workspace in context: ${ctx.workspace || 'null'}`);
    await next();
  });
  
  const initialData = {
    toolRequest: {
      name: 'test',
      args: {},
      conversationId: 'test'
    },
    workspace: process.cwd()
  };
  
  await runtime.execute(initialData);
  
  if (workspaceSet) {
    console.log('✅ WorkspaceStage passed');
  } else {
    console.log('❌ WorkspaceStage failed: workspace not set');
  }
  
  console.log('');
}

async function main() {
  console.log('V2.1 Runtime Test Suite\n');
  
  await testWorkspaceStage();
  await testBasicRuntime();
  
  console.log('All tests completed.');
}

main().catch(console.error);
