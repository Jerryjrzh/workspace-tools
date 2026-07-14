// src/runtime/harness.js - Simple test framework for Runtime
import { AgentRuntime } from './AgentRuntime.js';
import { WorkspaceStage } from './stages/WorkspaceStage.js';
import { GuardStage } from './stages/GuardStage.js';
import { RuntimeContextStage } from './stages/RuntimeContextStage.js';

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
      runtime.use(RuntimeContextStage);
      if (testCase.stages) {
        for (const stage of testCase.stages) {
          runtime.use(stage);
        }
      } else {
        runtime.use(GuardStage);
      }
      runtime.use((ctx, next) => {
        ctx.state = ctx.state || {};
        return next();
      });
    }
    
    // Add tool as final stage
    runtime.use(async (ctx, next) => {
      ctx.result = await toolFn(ctx, ctx.toolRequest.args);
      await next();
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

    if (testCase.assertions) {
      for (const assertion of testCase.assertions) {
        if (!assertion(finalCtx)) {
          throw new Error('Assertion failed');
        }
      }
    }

    return finalCtx;
  };
}

function expectWorkspace(ctx, expectedWorkspace) {
  return ctx.workspace === expectedWorkspace;
}

function expectState(ctx, key, value) {
  return ctx.state?.[key] === value;
}

function expectBackup(ctx, fileName) {
  const backups = ctx.state?.guardBackups || [];
  return backups.some((backup) => backup.includes(fileName));
}

async function expectThrows(fn, matcher) {
  try {
    await fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    if (matcher && !matcher.test(error.message)) {
      throw error;
    }
  }
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

export { runTest, createToolHarness, runSuite, expectWorkspace, expectState, expectBackup, expectThrows };
