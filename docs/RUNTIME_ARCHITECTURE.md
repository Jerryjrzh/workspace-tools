# Runtime Architecture v2

## Overview

This document describes the new runtime architecture implemented in workspace-tools, addressing the issues identified in `review_gpt7.md`.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    RUNTIME HARNESS (orchestrator)                   │
│  ┌──────────┬──────────┬──────────┬──────────┬─────────────────┐   │
│  │ Planner  │ Budget   │ Retry    │ Prompt   │ Specialized     │   │
│  │          │ Manager  │ Policy   │ Cache    │ Tools         │   │
│  └──────────┴──────────┴──────────┴──────────┴─────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    SPECIALIZED LM TOOLS                             │
│  • lm_plan    - Task planning and decomposition                     │
│  • lm_review  - Code review and quality assessment                  │
│  • lm_generate - Code generation                                    │
│  • lm_analyze - Data analysis                                       │
│  • lm_summarize - Content summarization                             │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    LM STUDIO (local LLM)                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Task Planner (`src/managers/planner.js`)

**Purpose**: Breaks large tasks into smaller, manageable subtasks.

**Key Features**:
- `analyzeTask()`: Estimates task complexity and token usage
- `decomposeTask()`: Splits complex tasks based on detected phases or sentence chunks
- `executePlannedTask()`: Executes planned tasks with progress tracking

**Configuration**:
```javascript
const planner = new TaskPlanner({
  maxSubtasks: 5,
  defaultTokenBudget: 1000
});
```

### 2. Budget Manager (`src/managers/budgetManager.js`)

**Purpose**: Dynamic token budgeting and automatic task splitting.

**Key Features**:
- `calculateBudget()`: Calculates token budget with safety margin (default 80%)
- `estimateTokens()`: Estimates tokens from text
- `splitTask()`: Automatically splits tasks based on budget constraints
- Multiple split policies: auto, sentence, character

**Configuration**:
```javascript
const manager = new BudgetManager({
  maxTokens: 4096,
  safetyMargin: 0.8,
  splitPolicy: 'auto'
});
```

### 3. Retry Manager (`src/managers/retryManager.js`)

**Purpose**: Implements adaptive retry strategies.

**Key Features**:
- `reduceScope`: Halves task length on token/context errors
- `splitTask`: Splits task into two parts on format/JSON errors
- `askUser`: Prompts user for guidance after multiple failures
- `waitAndRetry`: Implements exponential backoff for rate limiting

**Configuration**:
```javascript
const manager = new RetryManager({
  maxRetries: 3,
  strategies: ['reduceScope', 'splitTask', 'askUser', 'waitAndRetry']
});
```

### 4. Prompt Cache Manager (`src/managers/promptCache.js`)

**Purpose**: Avoids embedding large prompts in Tool JSON.

**Key Features**:
- `storePrompt()`: Stores prompts in memory and disk with metadata
- `retrievePrompt()`: Retrieves cached prompts by ID
- Automatic pruning of entries older than 24 hours
- Creates prompt references for tool calls

**Configuration**:
```javascript
const manager = new PromptCacheManager({
  maxEntries: 100,
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
});
```

### 5. Runtime Harness (`src/managers/runtimeHarness.js`)

**Purpose**: Unified orchestrator integrating all components.

**Key Features**:
- `submitTask()`: Main entry point for task execution
- Automatic planning, budgeting, retrying, and caching
- Tool selection based on task description
- Statistics and history tracking

## Usage

### Basic Task Execution

```javascript
import { runtimeHarness } from './src/managers/runtimeHarness.js';

// Submit a task
const result = await runtimeHarness.submitTask(
  'Implement a REST API for user management with authentication',
  {
    maxTokens: 4096,
    model: 'gpt-4'
  }
);

console.log(result);
```

### Using Individual Components

```javascript
import { taskPlanner } from './src/managers/planner.js';
import { budgetManager } from './src/managers/budgetManager.js';
import { retryManager } from './src/managers/retryManager.js';

// Plan a task
const plan = await taskPlanner.planTask('Your task description');

// Check budget
const budget = await budgetManager.calculateBudget(
  'Your task description',
  { maxTokens: 4096 }
);

// Execute with retry
const result = await retryManager.executeWithRetry(
  async (context) => {
    // Your task execution logic
    return executeTask(context.currentTask);
  },
  { currentTask: 'Your task description' }
);
```

### Using Specialized Tools

```javascript
import { specializedTools } from './src/tools/lm_specialized.js';

// Planning
const planResult = await specializedTools.lm_plan({
  prompt: 'Plan the architecture for a microservices system',
  max_tokens: 2048
});

// Review
const reviewResult = await specializedTools.lm_review({
  content: codeToReview,
  focus: 'security',
  language: 'python'
});

// Generation
const generatedCode = await specializedTools.lm_generate({
  prompt: 'Write a Python function to process CSV files',
  language: 'python'
});
```

## Configuration

### Default Configuration

```javascript
const defaultConfig = {
  maxTokens: 4096,
  safetyMargin: 0.8,
  maxSubtasks: 5,
  maxRetries: 3,
  promptCacheMaxEntries: 100,
  promptCacheMaxAge: 24 * 60 * 60 * 1000
};
```

### Custom Configuration

```javascript
const customConfig = {
  maxTokens: 8192,
  safetyMargin: 0.7,
  maxSubtasks: 10,
  maxRetries: 5,
  promptCacheMaxEntries: 500,
  promptCacheMaxAge: 48 * 60 * 60 * 1000
};

// Initialize with custom config
const harness = new RuntimeHarness(customConfig);
```

## Statistics and Monitoring

```javascript
// Get runtime statistics
const stats = runtimeHarness.getStatistics();
console.log(stats);

// Get task history
const history = runtimeHarness.getTaskHistory('all');
history.forEach(task => {
  console.log(`Task: ${task.taskDescription.substring(0, 50)}...`);
  console.log(`Status: ${task.executionResult.success ? 'Success' : 'Failed'}`);
});
```

## Migration from Legacy

### Before (Legacy)

```javascript
// Direct lm_chat calls - no planning, budgeting, or retry
const result = await lm_chat({
  prompt: largeTaskDescription,
  max_tokens: 4096
});
```

### After (New Architecture)

```javascript
// Using Runtime Harness - automatic planning, budgeting, retry
const result = await runtimeHarness.submitTask(largeTaskDescription, {
  maxTokens: 4096
});

// Or using individual components
const plan = await taskPlanner.planTask(largeTaskDescription);
const budget = await budgetManager.calculateBudget(largeTaskDescription);
const result = await retryManager.executeWithRetry(
  async (ctx) => executeTask(ctx.currentTask),
  { currentTask: largeTaskDescription }
);
```

## Best Practices

1. **Always use Runtime Harness**: It provides automatic handling of planning, budgeting, and retries.

2. **Monitor token usage**: Use `budgetManager.checkBudgetStatus()` to track usage percentages.

3. **Cache large prompts**: Prompts > 5000 characters are automatically cached.

4. **Handle failures gracefully**: The retry manager will automatically attempt recovery strategies.

5. **Use specialized tools**: Select the appropriate tool based on task type for better results.

## Troubleshooting

### Task Too Large
- Error: "Token limit exceeded"
- Solution: Task is automatically split by Budget Manager. Check `budgetManager.getStatistics()`.

### Retry Exhausted
- Error: "Max retries exceeded"
- Solution: Task requires user intervention. Check `retryManager.getStatistics()` for details.

### Prompt Cache Miss
- Error: "Prompt not found"
- Solution: Ensure prompt was cached using `promptCacheManager.storePrompt()`. Check cache stats with `promptCacheManager.getStatistics()`.

## Future Enhancements

- [ ] Add distributed task execution support
- [ ] Implement task priority queue
- [ ] Add cost estimation and tracking
- [ ] Support for streaming responses
- [ ] Advanced prompt optimization