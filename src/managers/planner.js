// src/managers/planner.js
import fs from 'fs';
import path from 'path';

/**
 * Task Planner - Breaks large tasks into smaller subtasks
 * Implements the "Planner" layer from review_gpt7.md
 */

export class TaskPlanner {
  constructor(options = {}) {
    this.maxSubtasks = options.maxSubtasks || 5;
    this.defaultTokenBudget = options.tokenBudget || 1000;
    this.taskHistory = [];
  }

  /**
   * Main entry point - plan a task based on its complexity
   */
  async planTask(taskDescription, context = {}) {
    const analysis = await this.analyzeTask(taskDescription, context);
    
    if (analysis.complexity === 'simple') {
      return {
        planId: this.generatePlanId(),
        originalTask: taskDescription,
        subtasks: [this.createSubtask(0, taskDescription, analysis.estimatedTokens)],
        strategy: 'single',
        estimatedTotalTokens: analysis.estimatedTokens
      };
    }

    // Complex task - decompose into subtasks
    const subtasks = await this.decomposeTask(taskDescription, context);
    
    return {
      planId: this.generatePlanId(),
      originalTask: taskDescription,
      subtasks,
      strategy: 'decomposed',
      estimatedTotalTokens: subtasks.reduce((sum, st) => sum + st.estimatedTokens, 0),
      decompositionNotes: analysis.decompositionNotes
    };
  }

  /**
   * Analyze task complexity and estimate tokens
   */
  async analyzeTask(taskDescription, context) {
    // Simple heuristics for initial analysis
    const length = taskDescription.length;
    const wordCount = taskDescription.split(/\s+/).length;
    
    // Estimate tokens (roughly 1.3 tokens per word for English)
    const estimatedTokens = Math.ceil(wordCount * 1.3);
    
    // Determine complexity level
    let complexity = 'simple';
    if (estimatedTokens > this.defaultTokenBudget * 2) {
      complexity = 'complex';
    } else if (estimatedTokens > this.defaultTokenBudget) {
      complexity = 'moderate';
    }

    return {
      estimatedTokens,
      complexity,
      wordCount,
      decompositionNotes: this.generateDecompositionNotes(taskDescription, complexity)
    };
  }

  /**
   * Generate decomposition notes for complex tasks
   */
  generateDecompositionNotes(taskDescription, complexity) {
    const notes = [];
    
    if (complexity === 'complex') {
      notes.push('Task exceeds token budget - will be automatically split');
      notes.push('Consider breaking into logical phases');
      
      // Detect common patterns that suggest decomposition
      if (taskDescription.match(/(first|initially|then|finally)/i)) {
        notes.push('Detected sequential markers - can split by phase');
      }
      if (taskDescription.match(/(design|implement|test|review)/i)) {
        notes.push('Detected development phases - can split by activity');
      }
    }
    
    return notes;
  }

  /**
   * Decompose a task into subtasks
   */
  async decomposeTask(taskDescription, context) {
    const subtasks = [];
    let currentStep = 0;
    
    // Strategy 1: Split by logical phases detected in description
    const phaseKeywords = ['design', 'implement', 'test', 'review', 'document'];
    const detectedPhases = phaseKeywords.filter(keyword => 
      taskDescription.toLowerCase().includes(keyword)
    );
    
    if (detectedPhases.length > 1) {
      // Split by detected phases
      for (const phase of detectedPhases) {
        subtasks.push(this.createSubtask(
          currentStep++,
          `Phase: ${phase} - ${taskDescription}`,
          Math.ceil(this.defaultTokenBudget * 0.8)
        ));
      }
    } else {
      // Strategy 2: Split by sentence or logical chunks
      const sentences = taskDescription.split(/[.!?]+/).filter(s => s.trim());
      
      for (let i = 0; i < sentences.length && i < this.maxSubtasks; i++) {
        subtasks.push(this.createSubtask(
          currentStep++,
          `Chunk ${i + 1}/${Math.min(sentences.length, this.maxSubtasks)}: ${sentences[i].trim()}`,
          Math.ceil(this.defaultTokenBudget * 0.5)
        ));
      }
    }

    return subtasks;
  }

  /**
   * Create a subtask object
   */
  createSubtask(index, description, estimatedTokens) {
    return {
      id: `subtask_${index}`,
      index,
      description,
      status: 'pending',
      estimatedTokens,
      actualTokens: null,
      result: null,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Generate a unique plan ID
   */
  generatePlanId() {
    return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Execute a planned task with progress tracking
   */
  async executePlannedTask(plan, executor) {
    const results = [];
    
    for (const subtask of plan.subtasks) {
      console.log(`Executing subtask ${subtask.index + 1}/${plan.subtasks.length}: ${subtask.description}`);
      
      subtask.status = 'running';
      subtask.startTime = Date.now();
      
      try {
        const result = await executor(subtask);
        subtask.result = result;
        subtask.actualTokens = result?.tokenUsage || 0;
        subtask.status = 'completed';
        subtask.endTime = Date.now();
        
        results.push({
          subtaskId: subtask.id,
          success: true,
          result
        });
      } catch (error) {
        subtask.status = 'failed';
        subtask.endTime = Date.now();
        
        results.push({
          subtaskId: subtask.id,
          success: false,
          error: error.message
        });
      }
    }

    return {
      planId: plan.planId,
      totalSubtasks: plan.subtasks.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Save task history for learning
   */
  saveTaskHistory(taskType, plan, executionResult) {
    this.taskHistory.push({
      timestamp: new Date().toISOString(),
      taskType,
      planId: plan.planId,
      originalTask: plan.originalTask,
      subtaskCount: plan.subtasks.length,
      executionResult
    });
    
    // Persist to file
    const historyPath = path.join(process.cwd(), '.planner-history.json');
    fs.writeFileSync(historyPath, JSON.stringify(this.taskHistory, null, 2));
  }

  /**
   * Load task history
   */
  loadTaskHistory() {
    const historyPath = path.join(process.cwd(), '.planner-history.json');
    if (fs.existsSync(historyPath)) {
      this.taskHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    return this.taskHistory;
  }
}

// Singleton instance
export const taskPlanner = new TaskPlanner();