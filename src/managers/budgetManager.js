// src/managers/budgetManager.js
import fs from 'fs';
import path from 'path';

/**
 * Budget Manager - Dynamic token budgeting and task splitting
 * Implements the "Budget Manager" layer from review_gpt7.md
 */

export class BudgetManager {
  constructor(options = {}) {
    this.defaultMaxTokens = options.maxTokens || 4096;
    this.safetyMargin = options.safetyMargin || 0.8; // Use 80% of budget by default
    this.budgetHistory = [];
    this.splitPolicy = options.splitPolicy || 'auto';
  }

  /**
   * Calculate token budget for a task
   */
  async calculateBudget(taskDescription, context = {}) {
    const estimatedTokens = await this.estimateTokens(taskDescription);
    
    // Determine available budget
    let availableBudget;
    if (context.maxTokens) {
      availableBudget = context.maxTokens;
    } else {
      availableBudget = this.defaultMaxTokens;
    }

    // Apply safety margin
    const safeBudget = Math.floor(availableBudget * this.safetyMargin);
    
    return {
      estimatedTokens,
      availableBudget,
      safeBudget,
      maxOutputTokens: Math.floor(safeBudget * 0.5), // Reserve half for output
      requiresSplit: estimatedTokens > safeBudget,
      splitReason: estimatedTokens > safeBudget 
        ? `Estimated ${estimatedTokens} tokens exceeds safe budget of ${safeBudget}`
        : null
    };
  }

  /**
   * Estimate token usage for a task
   */
  async estimateTokens(text) {
    // Rough estimation: 1.3 tokens per word for English
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    
    // For Chinese/Japanese, roughly 1 token per character
    const charCount = text.length;
    
    // Use the larger estimate
    return Math.ceil(Math.max(wordCount * 1.3, charCount));
  }

  /**
   * Split task based on budget constraints
   */
  async splitTask(taskDescription, context) {
    const budget = await this.calculateBudget(taskDescription, context);
    
    if (!budget.requiresSplit) {
      return {
        success: true,
        tasks: [taskDescription],
        budgetInfo: budget
      };
    }

    // Determine split strategy
    let splitPoints = [];
    
    if (this.splitPolicy === 'auto') {
      splitPoints = this.autoDetectSplitPoints(taskDescription);
    } else if (this.splitPolicy === 'sentence') {
      splitPoints = this.sentenceBasedSplit(taskDescription);
    } else if (this.splitPolicy === 'character') {
      splitPoints = this.characterBasedSplit(taskDescription, budget.safeBudget);
    }

    // Create subtasks
    const tasks = [];
    let lastPoint = 0;
    
    for (const point of splitPoints) {
      const chunk = taskDescription.substring(lastPoint, point).trim();
      if (chunk.length > 0) {
        tasks.push(chunk);
      }
      lastPoint = point;
    }

    // Add remaining text
    const remaining = taskDescription.substring(lastPoint).trim();
    if (remaining.length > 0) {
      tasks.push(remaining);
    }

    return {
      success: true,
      tasks,
      budgetInfo: budget,
      splitPoints,
      chunkCount: tasks.length
    };
  }

  /**
   * Auto-detect logical split points
   */
  autoDetectSplitPoints(text) {
    const splitPoints = [];
    
    // Find natural break points
    const patterns = [
      { regex: /\.\s+/g, weight: 10 },     // Period followed by space
      { regex: /!\s+/g, weight: 8 },       // Exclamation mark
      { regex: /\?\s+/g, weight: 8 },      // Question mark
      { regex: /\n\s*\n/g, weight: 15 },   // Double newline (paragraph)
      { regex: /;\s+/g, weight: 5 },       // Semicolon
    ];

    let position = 0;
    
    for (const char of text) {
      const chunkBefore = text.substring(0, position);
      
      for (const pattern of patterns) {
        if (pattern.regex.test(chunkBefore)) {
          const matches = chunkBefore.match(pattern.regex);
          if (matches && matches.length > 0) {
            splitPoints.push(position);
            break;
          }
        }
      }
      
      position++;
    }

    // Sort and deduplicate
    return [...new Set(splitPoints)].sort((a, b) => a - b);
  }

  /**
   * Split based on sentence boundaries
   */
  sentenceBasedSplit(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const splitPoints = [];
    
    let currentPosition = 0;
    for (const sentence of sentences) {
      currentPosition += sentence.length;
      splitPoints.push(currentPosition);
    }
    
    return splitPoints;
  }

  /**
   * Split based on character count to fit budget
   */
  characterBasedSplit(text, budgetTokens) {
    // Roughly 2 characters = 1 token for mixed English/Chinese
    const maxChars = Math.floor(budgetTokens * 2);
    const splitPoints = [];
    
    let position = 0;
    while (position < text.length) {
      const chunk = text.substring(position, position + maxChars);
      
      // Try to end at a sentence boundary within the chunk
      const lastPeriod = chunk.lastIndexOf('.');
      if (lastPeriod > -1 && lastPeriod > maxChars * 0.8) {
        position += lastPeriod + 1;
      } else {
        position += maxChars;
      }
      
      splitPoints.push(position);
    }
    
    return splitPoints;
  }

  /**
   * Calculate cumulative token usage
   */
  calculateCumulativeUsage(taskResults) {
    let totalTokens = 0;
    let totalCost = 0;
    
    for (const result of taskResults) {
      const tokens = result.tokenUsage || 0;
      totalTokens += tokens;
      
      // Estimate cost (placeholder - replace with actual pricing)
      const cost = tokens * 0.0001; // $0.0001 per token (example)
      totalCost += cost;
    }
    
    return {
      totalTokens,
      totalCost,
      taskCount: taskResults.length
    };
  }

  /**
   * Check if budget is exceeded
   */
  checkBudgetStatus(currentUsage, budgetLimit) {
    const usagePercentage = (currentUsage / budgetLimit) * 100;
    
    return {
      currentUsage,
      budgetLimit,
      usagePercentage,
      isExceeded: currentUsage > budgetLimit,
      remaining: Math.max(0, budgetLimit - currentUsage),
      warningLevel: this.getWarningLevel(usagePercentage)
    };
  }

  /**
   * Get warning level based on usage percentage
   */
  getWarningLevel(percentage) {
    if (percentage >= 90) return 'critical';
    if (percentage >= 75) return 'warning';
    if (percentage >= 50) return 'normal';
    return 'low';
  }

  /**
   * Save budget history
   */
  saveBudgetHistory(taskId, budgetInfo, usage) {
    this.budgetHistory.push({
      taskId,
      timestamp: new Date().toISOString(),
      budgetInfo,
      actualUsage: usage
    });
    
    const historyPath = path.join(process.cwd(), '.budget-history.json');
    fs.writeFileSync(historyPath, JSON.stringify(this.budgetHistory, null, 2));
  }

  /**
   * Load budget history
   */
  loadBudgetHistory() {
    const historyPath = path.join(process.cwd(), '.budget-history.json');
    if (fs.existsSync(historyPath)) {
      this.budgetHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    return this.budgetHistory;
  }

  /**
   * Get budget statistics
   */
  getStatistics() {
    if (this.budgetHistory.length === 0) {
      return { totalTasks: 0, avgUsage: 0, maxUsage: 0 };
    }
    
    const usages = this.budgetHistory.map(h => h.actualUsage?.totalTokens || 0);
    
    return {
      totalTasks: this.budgetHistory.length,
      avgUsage: Math.round(usages.reduce((a, b) => a + b, 0) / usages.length),
      maxUsage: Math.max(...usages),
      minUsage: Math.min(...usages)
    };
  }
}

// Singleton instance
export const budgetManager = new BudgetManager();