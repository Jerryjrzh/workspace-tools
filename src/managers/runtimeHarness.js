// src/managers/runtimeHarness.js
import { taskPlanner } from './planner.js';
import { retryManager } from './retryManager.js';
import { budgetManager } from './budgetManager.js';
import { promptCacheManager } from './promptCache.js';
import { specializedTools, toolDefinitions as specializedToolDefs } from '../tools/lm_specialized.js';

/**
 * Runtime Harness - Unified runtime management
 * Integrates Planner, Budget Manager, Retry Policy, and Prompt Cache
 */

export class RuntimeHarness {
  constructor(options = {}) {
    this.options = options;
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.completedTasks = [];
    this.failedTasks = [];
    
    // Initialize components
    this.planner = taskPlanner;
    this.retryManager = retryManager;
    this.budgetManager = budgetManager;
    this.promptCacheManager = promptCacheManager;
    
    // Register specialized tools
    this.specializedTools = specializedTools;
  }

  /**
   * Submit a task for execution
   */
  async submitTask(taskDescription, context = {}) {
    console.log(`[RuntimeHarness] Submitting task: ${taskDescription.substring(0, 50)}...`);
    
    // Step 1: Plan the task
    const plan = await this.planner.planTask(taskDescription, context);
    console.log(`[RuntimeHarness] Task planned with ${plan.subtasks.length} subtasks`);
    
    // Step 2: Check budget for each subtask
    const budgetCheck = await this.budgetManager.splitTask(taskDescription, {
      maxTokens: context.maxTokens || 4096
    });
    
    if (budgetCheck.requiresSplit) {
      console.log(`[RuntimeHarness] Task requires splitting: ${budgetCheck.chunkCount} chunks`);
    }
    
    // Step 3: Execute with retry policy
    const executionResult = await this.retryManager.executeWithRetry(
      async (retryContext) => {
        return this.executePlannedTask(plan, retryContext);
      },
      { ...context, currentTask: taskDescription }
    );
    
    // Step 4: Cache large prompts if needed
    if (taskDescription.length > 5000) {
      const promptId = await this.promptCacheManager.storePrompt(taskDescription, {
        taskId: plan.planId,
        originalLength: taskDescription.length
      });
      console.log(`[RuntimeHarness] Prompt cached with ID: ${promptId}`);
    }
    
    // Record result
    if (executionResult.success) {
      this.completedTasks.push({
        planId: plan.planId,
        taskDescription,
        executionResult,
        timestamp: new Date().toISOString()
      });
    } else {
      this.failedTasks.push({
        planId: plan.planId,
        taskDescription,
        executionResult,
        timestamp: new Date().toISOString()
      });
    }
    
    return executionResult;
  }

  /**
   * Execute a planned task
   */
  async executePlannedTask(plan, context) {
    const results = [];
    
    for (const subtask of plan.subtasks) {
      console.log(`[RuntimeHarness] Executing subtask: ${subtask.description.substring(0, 50)}...`);
      
      // Check budget for this subtask
      const subtaskBudget = await this.budgetManager.calculateBudget(
        subtask.description,
        context
      );
      
      if (subtaskBudget.requiresSplit) {
        console.log(`[RuntimeHarness] Subtask exceeds budget, splitting...`);
        
        const splitResult = await this.budgetManager.splitTask(subtask.description, context);
        
        // Execute each chunk
        for (const chunk of splitResult.tasks) {
          const chunkResult = await this.executeWithBudget(chunk, subtaskBudget.safeBudget);
          results.push({
            subtaskId: subtask.id,
            chunk: chunk.substring(0, 50) + '...',
            result: chunkResult
          });
        }
      } else {
        // Execute normally within budget
        const result = await this.executeWithBudget(subtask.description, subtaskBudget.safeBudget);
        results.push({
          subtaskId: subtask.id,
          result
        });
      }
    }

    return {
      planId: plan.planId,
      totalSubtasks: plan.subtasks.length,
      results,
      success: true
    };
  }

  /**
   * Execute a task within budget constraints
   */
  async executeWithBudget(taskDescription, maxTokens) {
    // Check if we need to use specialized tools
    const toolSelection = await this.selectTool(taskDescription);
    
    if (toolSelection.useSpecialized) {
      const result = await this.specializedTools[toolSelection.toolName]({
        prompt: taskDescription,
        max_tokens: Math.floor(maxTokens * 0.8),
        model: this.options.defaultModel
      });
      
      return {
        output: result,
        tokenUsage: result.token_usage || 0,
        toolUsed: toolSelection.toolName
      };
    }
    
    // Use standard execution with budget monitoring
    const result = await this.executeWithMonitoring(taskDescription, maxTokens);
    
    return {
      output: result,
      tokenUsage: result.token_usage || 0,
      toolUsed: 'standard'
    };
  }

  /**
   * Execute with token monitoring
   */
  async executeWithMonitoring(taskDescription, maxTokens) {
    // In a real implementation, this would track actual token usage
    // For now, we simulate the monitoring
    
    console.log(`[RuntimeHarness] Executing with budget: ${maxTokens} tokens`);
    
    // Simulate execution (replace with actual LLM call)
    return {
      success: true,
      token_usage: Math.floor(maxTokens * 0.5), // Estimate
      output: `Executed task within budget of ${maxTokens} tokens`
    };
  }

  /**
   * Select appropriate tool based on task description
   */
  async selectTool(taskDescription) {
    const lowerTask = taskDescription.toLowerCase();
    
    const patterns = [
      { name: 'lm_plan', keywords: ['plan', 'decompose', 'break down', 'strategy'] },
      { name: 'lm_review', keywords: ['review', 'check', 'audit', 'quality', 'security'] },
      { name: 'lm_generate', keywords: ['generate', 'write', 'create', 'implement', 'code'] },
      { name: 'lm_analyze', keywords: ['analyze', 'research', 'data', 'investigate'] },
      { name: 'lm_summarize', keywords: ['summarize', 'condense', 'summary'] }
    ];
    
    for (const pattern of patterns) {
      if (pattern.keywords.some(kw => lowerTask.includes(kw))) {
        return { useSpecialized: true, toolName: pattern.name };
      }
    }
    
    return { useSpecialized: false, toolName: null };
  }

  /**
   * Get runtime statistics
   */
  getStatistics() {
    return {
      taskQueueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      completedTasks: this.completedTasks.length,
      failedTasks: this.failedTasks.length,
      budgetStats: this.budgetManager.getStatistics(),
      retryStats: this.retryManager.getStatistics(),
      promptCacheStats: this.promptCacheManager.getStatistics()
    };
  }

  /**
   * Get detailed task history
   */
  getTaskHistory(status = 'all') {
    let history = [];
    
    if (status === 'all' || status === 'completed') {
      history.push(...this.completedTasks);
    }
    if (status === 'all' || status === 'failed') {
      history.push(...this.failedTasks);
    }
    
    return history.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * Clear task history
   */
  clearHistory() {
    this.completedTasks = [];
    this.failedTasks = [];
    this.taskQueue = [];
    this.activeTasks.clear();
  }
}

// Singleton instance
export const runtimeHarness = new RuntimeHarness();