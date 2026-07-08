// src/managers/retryManager.js
import fs from 'fs';
import path from 'path';

/**
 * Retry Manager - Implements adaptive retry strategies
 * Addresses the "Retry Strategy" issue from review_gpt7.md
 */

export class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryHistory = [];
    this.strategies = {
      reduceScope: this.reduceScopeStrategy.bind(this),
      splitTask: this.splitTaskStrategy.bind(this),
      askUser: this.askUserStrategy.bind(this),
      waitAndRetry: this.waitAndRetryStrategy.bind(this)
    };
  }

  /**
   * Main retry entry point
   */
  async executeWithRetry(taskFn, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await taskFn(context);
        return {
          success: true,
          result,
          attempts: attempt + 1
        };
      } catch (error) {
        lastError = error;
        
        // Log retry attempt
        this.logRetryAttempt(attempt, error.message, context);
        
        if (attempt < this.maxRetries) {
          // Determine and apply retry strategy
          const strategy = this.determineStrategy(error, attempt, context);
          await this.applyStrategy(strategy, error, attempt, context);
        }
      }
    }

    return {
      success: false,
      error: lastError.message,
      attempts: this.maxRetries + 1,
      finalStrategy: this.determineFinalStrategy(lastError)
    };
  }

  /**
   * Determine which retry strategy to use
   */
  determineStrategy(error, attempt, context) {
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Strategy selection based on error type
    if (errorMessage.includes('token') || 
        errorMessage.includes('context') ||
        errorMessage.includes('length')) {
      return 'reduceScope';
    }
    
    if (errorMessage.includes('format') ||
        errorMessage.includes('json') ||
        errorMessage.includes('parse')) {
      return 'splitTask';
    }
    
    if (attempt === 0) {
      // First failure - try reducing scope
      return 'reduceScope';
    }
    
    if (attempt === 1) {
      // Second failure - try splitting task
      return 'splitTask';
    }
    
    // Third failure - ask user or wait
    return errorMessage.includes('rate') ? 'waitAndRetry' : 'askUser';
  }

  /**
   * Apply the selected retry strategy
   */
  async applyStrategy(strategyName, error, attempt, context) {
    const strategy = this.strategies[strategyName];
    
    if (strategy) {
      console.log(`Applying retry strategy: ${strategyName} (attempt ${attempt + 1})`);
      
      const strategyResult = await strategy(error, context);
      
      // Update context based on strategy result
      Object.assign(context, strategyResult.contextUpdates || {});
      
      return strategyResult;
    }
    
    throw new Error(`Unknown strategy: ${strategyName}`);
  }

  /**
   * Strategy: Reduce scope of the task
   */
  async reduceScopeStrategy(error, context) {
    const previousTask = context.currentTask || '';
    
    // Reduce by half
    const reducedTask = this.reduceTaskByHalf(previousTask);
    
    return {
      contextUpdates: {
        currentTask: reducedTask,
        retryReason: 'reduce_scope',
        originalTaskLength: previousTask.length,
        reducedTaskLength: reducedTask.length
      },
      delayMs: 1000 // Small delay before retry
    };
  }

  /**
   * Strategy: Split task into smaller parts
   */
  async splitTaskStrategy(error, context) {
    const previousTask = context.currentTask || '';
    
    // Split into two parts
    const midPoint = Math.floor(previousTask.length / 2);
    const part1 = previousTask.substring(0, midPoint).trim();
    const part2 = previousTask.substring(midPoint).trim();
    
    return {
      contextUpdates: {
        currentTask: part1,
        pendingTask: part2,
        retryReason: 'split_task',
        splitPoints: [midPoint]
      },
      delayMs: 500
    };
  }

  /**
   * Strategy: Ask user for guidance
   */
  async askUserStrategy(error, context) {
    return {
      contextUpdates: {
        requiresUserInput: true,
        retryReason: 'ask_user',
        errorDetails: error.message,
        suggestedActions: [
          'Provide more specific instructions',
          'Break the task into smaller steps',
          'Increase token budget if appropriate'
        ]
      },
      delayMs: 0 // No delay - wait for user
    };
  }

  /**
   * Strategy: Wait and retry (for rate limiting)
   */
  async waitAndRetryStrategy(error, context) {
    const baseDelay = 2000;
    const exponentialBackoff = Math.pow(2, context.retryCount || 0) * baseDelay;
    
    return {
      contextUpdates: {
        retryReason: 'wait_and_retry',
        delayMs: exponentialBackoff
      },
      delayMs: exponentialBackoff
    };
  }

  /**
   * Reduce task by half (safely)
   */
  reduceTaskByHalf(task) {
    const words = task.split(/\s+/);
    const halfLength = Math.floor(words.length / 2);
    
    // Keep the first half, but ensure we don't cut off mid-sentence
    let reduced = words.slice(0, halfLength).join(' ');
    
    // Try to end at a sentence boundary
    const lastPeriod = reduced.lastIndexOf('.');
    if (lastPeriod > -1) {
      reduced = reduced.substring(0, lastPeriod + 1);
    }
    
    return reduced.trim();
  }

  /**
   * Determine the final strategy when all retries fail
   */
  determineFinalStrategy(error) {
    const errorMessage = error.message?.toLowerCase() || '';
    
    if (errorMessage.includes('token') || errorMessage.includes('context')) {
      return 'reduce_scope';
    }
    
    if (errorMessage.includes('format') || errorMessage.includes('json')) {
      return 'split_task';
    }
    
    return 'ask_user';
  }

  /**
   * Log retry attempt for debugging
   */
  logRetryAttempt(attempt, error, context) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      attempt,
      error,
      context: {
        currentTask: context.currentTask?.substring(0, 100),
        retryCount: context.retryCount || 0
      }
    };
    
    this.retryHistory.push(logEntry);
    
    // Persist history
    const historyPath = path.join(process.cwd(), '.retry-history.json');
    fs.writeFileSync(historyPath, JSON.stringify(this.retryHistory, null, 2));
  }

  /**
   * Get retry statistics
   */
  getStatistics() {
    if (this.retryHistory.length === 0) {
      return { totalRetries: 0, strategiesUsed: {} };
    }
    
    const strategiesUsed = {};
    let totalRetries = 0;
    
    for (const entry of this.retryHistory) {
      totalRetries++;
      const strategy = entry.strategy || 'unknown';
      strategiesUsed[strategy] = (strategiesUsed[strategy] || 0) + 1;
    }
    
    return {
      totalRetries,
      strategiesUsed,
      historyLength: this.retryHistory.length
    };
  }

  /**
   * Clear retry history
   */
  clearHistory() {
    this.retryHistory = [];
    const historyPath = path.join(process.cwd(), '.retry-history.json');
    if (fs.existsSync(historyPath)) {
      fs.unlinkSync(historyPath);
    }
  }
}

// Singleton instance
export const retryManager = new RetryManager();