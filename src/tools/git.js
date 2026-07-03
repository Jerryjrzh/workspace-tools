// src/tools/git.js
import { workspaceManager } from '../managers/workspace.js';
import { ToolMiddleware } from '../utils/middleware.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const gitTools = [
  {
    name: "git_status",
    description: "git status + 最近 commits",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "git_diff",
    description: "查看 git diff。",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean" },
        file: { type: "string" }
      }
    }
  },
  {
    name: "git_commit",
    description: "执行 git add + commit，支持自动生成 commit message（调用本地模型）",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "commit message（留空则调用本地模型自动生成）" },
        files: { 
          type: "array", 
          items: { type: "string" }, 
          description: "要 add 的文件列表，默认 ['.']（全部）",
          default: ["."]
        },
        auto_message: { type: "boolean", description: "是否用本地模型自动生成 commit message，默认 false", default: false }
      }
    }
  },
  {
    name: "git_branch",
    description: "git 分支操作：列出/创建/切换/删除分支",
    inputSchema: {
      type: "object",
      properties: {
        action: { 
          type: "string", 
          enum: ["list", "create", "checkout", "delete", "current"], 
          description: "list | create | checkout | delete | current" 
        },
        name: { type: "string", description: "分支名（create/checkout/delete 时必填）" },
        base: { type: "string", description: "基础分支（create 时可选）" }
      },
      required: ["action"]
    }
  },
  {
    name: "git_stash",
    description: "git stash 操作：保存/恢复/列出/删除暂存",
    inputSchema: {
      type: "object",
      properties: {
        action: { 
          type: "string", 
          enum: ["push", "pop", "list", "drop", "show"], 
          description: "push | pop | list | drop | show" 
        },
        message: { type: "string", description: "stash 描述（push 时可选）" },
        index: { type: "number", description: "stash 索引（pop/drop/show 时可选，默认 0）" }
      },
      required: ["action"]
    }
  },
  {
    name: "git_log",
    description: "查看 git 提交历史，支持过滤和格式化",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "显示条数，默认 20" },
        author: { type: "string", description: "按作者过滤" },
        since: { type: "string", description: "起始时间，如 '2 weeks ago'" },
        file: { type: "string", description: "只看某文件的历史" },
        oneline: { type: "boolean", description: "单行格式，默认 true" }
      }
    }
  }
];

export async function handleGitTools(name, args, convId) {
  // Use middleware for security and context
  return await ToolMiddleware.executeWithMiddleware(
    async (toolName, toolArgs, context) => {
      const ws = context.workspace;
      
      switch (toolName) {
        case "git_status": {
          const { stdout } = await execAsync('git status', { cwd: ws });
          return stdout;
        }
        
        case "git_diff": {
          let cmd = 'git diff';
          if (args.staged) cmd += ' --staged';
          if (args.file) cmd += ` -- ${args.file}`;
          const { stdout } = await execAsync(cmd, { cwd: ws });
          return stdout;
        }
        
        case "git_commit": {
          // Add files first
          const filesArg = args.files && args.files.length > 0 ? args.files.join(' ') : '.';
          await execAsync(`git add ${filesArg}`, { cwd: ws });
          
          let commitMessage = args.message;
          if (args.auto_message || !commitMessage) {
            // In a real implementation, this would call lm_chat to generate a message
            commitMessage = args.message || `feat: automated commit via MCP Server`;
          }
          
          const { stdout } = await execAsync(`git commit -m "${commitMessage}"`, { cwd: ws });
          return stdout;
        }
        
        case "git_branch": {
          let cmd = 'git branch';
          switch (args.action) {
            case "list":
              cmd += ' -a';
              break;
            case "create":
              if (!args.name) throw new Error("分支名是必填的");
              cmd += ` ${args.name}`;
              if (args.base) cmd += ` ${args.base}`;
              break;
            case "checkout":
              if (!args.name) throw new Error("分支名是必填的");
              cmd += ` ${args.name}`;
              break;
            case "delete":
              if (!args.name) throw new Error("分支名是必填的");
              cmd += ` -d ${args.name}`;
              break;
            case "current":
              cmd += ' --show-current';
              break;
          }
          const { stdout } = await execAsync(cmd, { cwd: ws });
          return stdout;
        }
        
        case "git_stash": {
          let cmd = 'git stash';
          switch (args.action) {
            case "push":
              cmd += ' push';
              if (args.message) cmd += ` -m "${args.message}"`;
              break;
            case "pop":
              cmd += ' pop';
              if (args.index !== undefined) cmd += ` ${args.index}`;
              break;
            case "list":
              cmd += ' list';
              break;
            case "drop":
              cmd += ' drop';
              if (args.index !== undefined) cmd += ` ${args.index}`;
              break;
            case "show":
              cmd += ' show';
              if (args.index !== undefined) cmd += ` ${args.index}`;
              else cmd += ' --include-untrusted';
              break;
          }
          const { stdout } = await execAsync(cmd, { cwd: ws });
          return stdout;
        }
        
        case "git_log": {
          let cmd = 'git log';
          if (args.limit) cmd += ` -${args.limit}`;
          if (args.author) cmd += ` --author="${args.author}"`;
          if (args.since) cmd += ` --since="${args.since}"`;
          if (args.file) cmd += ` -- ${args.file}`;
          if (args.oneline) cmd += ' --oneline';
          const { stdout } = await execAsync(cmd, { cwd: ws });
          return stdout;
        }
        
        default:
          throw new Error(`未知 git 工具: ${name}`);
      }
    },
    name,
    args,
    { conversation_id: convId }
  );
}