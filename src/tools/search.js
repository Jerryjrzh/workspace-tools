import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolMiddleware } from '../utils/middleware.js';

const execFileAsync = promisify(execFile);
const MAX_RESULTS = 200;

export const searchTools = [
  {
    name: 'locate',
    description: '在整个 workspace 中一次定位多个文件名、路径或文本符号。默认同时搜索路径和内容，支持正则、glob 和上下文行。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '文件名、路径片段、符号或正则表达式' },
        path: { type: 'string', description: '搜索起点，默认 workspace 根目录' },
        glob: { type: 'string', description: '文件过滤，如 *.py 或 **/*.js' },
        mode: { type: 'string', enum: ['all', 'content', 'files'], description: '默认 all' },
        regex: { type: 'boolean', description: 'query 是否为正则，默认 true' },
        context_lines: { type: 'number', description: '内容匹配的上下文行数，默认 0' },
        max_results: { type: 'number', description: '最多返回结果，默认 100，最大 200' }
      },
      required: ['query']
    }
  },
  {
    name: 'file_search',
    description: '在 workspace 文件内容中批量搜索符号或文本；多个符号可用正则 | 一次完成定位。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' },
        regex: { type: 'boolean' }, context_lines: { type: 'number' }, max_results: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'glob_search',
    description: '按 glob 或文件名模式定位 workspace 中的文件，不读取文件内容。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'number' } },
      required: ['query']
    }
  }
];

async function runRg(args, cwd) {
  try {
    const { stdout } = await execFileAsync('rg', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }
}

async function search(toolName, args, workspace) {
  const root = path.resolve(workspace, args.path || '.');
  if (!root.startsWith(path.resolve(workspace)) || !fs.existsSync(root)) throw new Error(`无效搜索路径: ${root}`);
  const limit = Math.min(Math.max(Number(args.max_results) || 100, 1), MAX_RESULTS);
  const mode = toolName === 'file_search' ? 'content' : toolName === 'glob_search' ? 'files' : (args.mode || 'all');
  const result = { ok: true, status: 'located', operation: toolName, root, query: args.query, fileMatches: [], contentMatches: [], truncated: false };

  if (mode === 'all' || mode === 'files') {
    const pattern = toolName === 'glob_search' ? args.query : `*${args.query}*`;
    // Use --no-ignore so files excluded by .gitignore (e.g. doc/) are still locatable.
    result.fileMatches = (await runRg(['--files', '-u', '-g', pattern, '.'], root)).slice(0, limit);
  }
  if (mode === 'all' || mode === 'content') {
    const rgArgs = ['--line-number', '--no-heading', '--color', 'never'];
    // --no-ignore lets content inside gitignored dirs (e.g. doc/) be searched,
    // while the explicit glob exclusions keep node_modules/.git/hidden noise out.
    rgArgs.push('-u');
    for (const exclude of ['node_modules/**', '.git/**', '.*']) {
      rgArgs.push('--glob', `!${exclude}`);
    }
    if (args.regex === false) rgArgs.push('--fixed-strings');
    const context = Math.max(Number(args.context_lines) || 0, 0);
    if (context) rgArgs.push('--context', String(context));
    if (args.glob) rgArgs.push('--glob', args.glob);
    rgArgs.push('--', args.query, '.');
    result.contentMatches = (await runRg(rgArgs, root)).slice(0, limit);
  }
  result.truncated = result.fileMatches.length >= limit || result.contentMatches.length >= limit;
  result.matchCount = result.fileMatches.length + result.contentMatches.length;
  result.nextAction = result.matchCount ? 'use_locations' : 'refine_query';
  return result;
}

export async function handleSearchTools(name, args, context) {
  return ToolMiddleware.executeWithMiddleware(
    (_toolName, toolArgs, runtimeContext) => search(name, toolArgs, runtimeContext.workspace || process.cwd()),
    name,
    args,
    { conversation_id: context?.sessionId || context?.conversation_id || context }
  );
}
