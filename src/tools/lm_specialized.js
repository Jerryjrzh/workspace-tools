// src/tools/lm_specialized.js
import { lm_chat } from './session.js';

/**
 * Specialized LM Tools - Split from generic lm_chat
 * Addresses the "LM Runtime" layer from review_gpt7.md
 */

/**
 * lm_plan - Planning focused LLM calls
 * Used for task planning, decomposition, and strategy formulation
 */
export async function lm_plan(args) {
  const { prompt, system, model, max_tokens = 2048, ...rest } = args;
  
  const defaultSystem = `You are an expert task planner. Your role is to:
1. Break down complex tasks into smaller, manageable subtasks
2. Identify dependencies between tasks
3. Estimate resource requirements for each task
4. Create execution strategies that minimize token usage

Output format: JSON with structure:
{
  "plan_id": "unique_identifier",
  "original_task": "original task description",
  "subtasks": [
    {
      "id": "subtask_1",
      "description": "specific subtask description",
      "estimated_tokens": number,
      "dependencies": ["subtask_0"]
    }
  ],
  "strategy": "execution_strategy",
  "estimated_total_tokens": total_token_count
}`;

  return lm_chat({
    prompt,
    system: system || defaultSystem,
    model,
    max_tokens,
    ...rest
  });
}

/**
 * lm_review - Review focused LLM calls
 * Used for code review, security analysis, and quality assessment
 */
export async function lm_review(args) {
  const { content, focus = 'all', language, model, max_tokens = 2048, ...rest } = args;
  
  const defaultSystem = `You are an expert code reviewer. Your role is to:
1. Analyze code for bugs, security vulnerabilities, and performance issues
2. Check against best practices and coding standards
3. Provide specific, actionable recommendations
4. Rate the quality of the code on a scale of 1-5

Output format: JSON with structure:
{
  "quality_rating": number,
  "issues_found": [
    {
      "severity": "critical|high|medium|low",
      "category": "security|performance|correctness|style",
      "description": "issue description",
      "location": "file:line",
      "recommendation": "how to fix"
    }
  ],
  "summary": "overall review summary",
  "files_reviewed": number,
  "total_issues": number
}`;

  return lm_chat({
    prompt: `Please review the following code:\n\n${content}`,
    system: system || defaultSystem,
    model,
    max_tokens,
    ...rest
  });
}

/**
 * lm_generate - Code generation focused LLM calls
 * Used for writing new code, refactoring, and implementation
 */
export async function lm_generate(args) {
  const { prompt, language, model, max_tokens = 4096, ...rest } = args;
  
  const defaultSystem = `You are an expert software developer. Your role is to:
1. Write clean, maintainable, and efficient code
2. Follow best practices for the specified programming language
3. Include appropriate comments and documentation
4. Handle edge cases and error conditions

Output format: Code block with proper syntax highlighting.
If multiple files are needed, separate them clearly.

Example:
\`\`\`python
# Your Python code here
\`\`\`

\`\`\`javascript
// Your JavaScript code here
\`\`\`
`;

  return lm_chat({
    prompt,
    system: system || defaultSystem,
    model,
    max_tokens,
    ...rest
  });
}

/**
 * lm_analyze - Analysis focused LLM calls
 * Used for data analysis, research, and complex reasoning
 */
export async function lm_analyze(args) {
  const { prompt, context, model, max_tokens = 2048, ...rest } = args;
  
  const defaultSystem = `You are an expert analyst. Your role is to:
1. Analyze data, text, or code systematically
2. Identify patterns, trends, and anomalies
3. Provide evidence-based conclusions
4. Suggest actionable insights

Output format: JSON with structure:
{
  "analysis_type": "type_of_analysis",
  "key_findings": [
    {
      "finding": "description of finding",
      "evidence": "supporting evidence",
      "confidence": number (0-1)
    }
  ],
  "conclusions": [
    "list of conclusions"
  ],
  "recommendations": [
    "actionable recommendations"
  ]
}`;

  const fullPrompt = context 
    ? `Context:\n${context}\n\nAnalysis Request:\n${prompt}`
    : `Analysis Request:\n${prompt}`;

  return lm_chat({
    prompt: fullPrompt,
    system: system || defaultSystem,
    model,
    max_tokens,
    ...rest
  });
}

/**
 * lm_summarize - Summarization focused LLM calls
 * Used for condensing long documents, conversations, or code
 */
export async function lm_summarize(args) {
  const { content, maxLength = 500, model, max_tokens = 1024, ...rest } = args;
  
  const defaultSystem = `You are an expert summarizer. Your role is to:
1. Condense long text into a concise summary
2. Preserve key information and main points
3. Maintain the original tone and style when appropriate
4. Highlight important findings or conclusions

Output format: JSON with structure:
{
  "summary": "concise summary text",
  "key_points": [
    "bullet point 1",
    "bullet point 2"
  ],
  "original_length": number,
  "summary_length": number,
  "compression_ratio": number
}`;

  return lm_chat({
    prompt: `Please summarize the following content (max ${maxLength} words):\n\n${content}`,
    system: system || defaultSystem,
    model,
    max_tokens,
    ...rest
  });
}

// Export all specialized tools
export const specializedTools = {
  lm_plan,
  lm_review,
  lm_generate,
  lm_analyze,
  lm_summarize
};

// Tool definitions for registration
export const toolDefinitions = [
  {
    name: 'lm_plan',
    description: 'Planning focused LLM calls for task decomposition and strategy formulation',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The planning prompt' },
      system: { type: 'string', required: false, description: 'Custom system prompt' },
      model: { type: 'string', required: false, description: 'Model ID' },
      max_tokens: { type: 'number', required: false, default: 2048, description: 'Maximum output tokens' }
    }
  },
  {
    name: 'lm_review',
    description: 'Review focused LLM calls for code analysis and quality assessment',
    parameters: {
      content: { type: 'string', required: true, description: 'Code or text to review' },
      focus: { type: 'string', required: false, default: 'all', enum: ['security', 'performance', 'correctness', 'style', 'all'], description: 'Review focus area' },
      language: { type: 'string', required: false, description: 'Programming language' },
      model: { type: 'string', required: false, description: 'Model ID' },
      max_tokens: { type: 'number', required: false, default: 2048, description: 'Maximum output tokens' }
    }
  },
  {
    name: 'lm_generate',
    description: 'Code generation focused LLM calls for implementation',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Generation prompt' },
      language: { type: 'string', required: false, description: 'Target programming language' },
      model: { type: 'string', required: false, description: 'Model ID' },
      max_tokens: { type: 'number', required: false, default: 4096, description: 'Maximum output tokens' }
    }
  },
  {
    name: 'lm_analyze',
    description: 'Analysis focused LLM calls for data and research analysis',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Analysis request' },
      context: { type: 'string', required: false, description: 'Additional context data' },
      model: { type: 'string', required: false, description: 'Model ID' },
      max_tokens: { type: 'number', required: false, default: 2048, description: 'Maximum output tokens' }
    }
  },
  {
    name: 'lm_summarize',
    description: 'Summarization focused LLM calls for condensing content',
    parameters: {
      content: { type: 'string', required: true, description: 'Content to summarize' },
      maxLength: { type: 'number', required: false, default: 500, description: 'Maximum summary length in words' },
      model: { type: 'string', required: false, description: 'Model ID' },
      max_tokens: { type: 'number', required: false, default: 1024, description: 'Maximum output tokens' }
    }
  }
];