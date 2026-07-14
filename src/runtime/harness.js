// src/runtime/harness.js - Simple test framework for Runtime
import { AgentRuntime } from './AgentRuntime.js';
import { WorkspaceStage } from './stages/WorkspaceStage.js';

/**
 * Run a single test case
 * @param {string} name - Test name
 * @param {Function} testFn - Async test function
 * @returns {Promise<boolean>} - true if passed
 */
async function runTest(name, testFn) {
  try {
    console.log(`  ${name}...`);
    await testFn();
    console.log(`    ✅ PASS`);
    return true;
  } catch (error) {
    console.log(`    ❌ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Create a test harness for a tool
 * @param {Function} toolFn - The tool function (ctx, args) => result
 * @param {Object} testCase - Test input/output
 * @returns {Function} - Test function
 */
function createToolHarness(toolFn, testCase) {
  return async () => {
    const runtime = new AgentRuntime();
    
    // Add WorkspaceStage if test provides workspace
    if (testCase.workspace) {
      runtime.use(WorkspaceStage);
    }
    
    // Add tool as final stage
    runtime.use(async (ctx, next) => {
      ctx.result = await toolFn(ctx, ctx.toolRequest.args);
    });
    
    const initialData = {
      sessionId: testCase.sessionId || 'test',
      toolRequest: {
        name: testCase.toolName || 'test_tool',
        args: testCase.args || {},
        conversationId: testCase.sessionId || 'test'
      },
      workspace: testCase.workspace || null
    };
    
    const finalCtx = await runtime.execute(initialData);
    
    if (testCase.expect) {
      if (typeof testCase.expect === 'function') {
        if (!testCase.expect(finalCtx.result, finalCtx)) {
          throw new Error('Test expectation failed');
        }
      } else if (finalCtx.result !== testCase.expect) {
        throw new Error(`Expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(finalCtx.result)}`);
      }
    }
  };
}

/**
 * Run test suite
 * @param {Object} options
 * @param {string} options.name - Suite name
 * @param {Array} options.tests - Array of { name, testFn }
 */
async function runSuite(options) {
  console.log(`\n${options.name}`);
  console.log('='.repeat(50));
  
  const results = [];
  for (const test of options.tests) {
    const passed = await runTest(test.name, test.testFn);
    results.push({ name: test.name, passed });
  }
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  console.log(`\n${passed}/${total} tests passed`);
  console.log('='.repeat(50) + '\n');
  
  return passed === total;
}

export { runTest, createToolHarness, runSuite };
