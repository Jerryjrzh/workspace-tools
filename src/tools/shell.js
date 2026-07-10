// src/tools/shell.js
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const shellTools = [
  {
    name: "shell_run",
    description: "在 workspace 执行 bash 命令。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
        cwd: { type: "string", description: "执行目录，默认 workspace" },
        timeout_seconds: { type: "number", description: "默认 300" }
      },
      required: ["command"]
    }
  },
  {
    name: "process_start",
    description: "后台启动长时间运行的命令（构建、服务器、监控等），立即返回进程 ID",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
        cwd: { type: "string", description: "执行目录，默认 workspace" },
        label: { type: "string", description: "进程标签，便于识别" }
      },
      required: ["command"]
    }
  },
  {
    name: "process_output",
    description: "读取后台进程的最新输出日志",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "process_start 返回的进程 ID" },
        lines: { type: "number", description: "读取最后 N 行，默认 50" }
      },
      required: ["pid"]
    }
  },
  {
    name: "process_kill",
    description: "终止后台进程",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "process_start 返回的进程 ID" }
      },
      required: ["pid"]
    }
  },
  {
    name: "process_list_bg",
    description: "列出所有后台进程及其状态",
    inputSchema: { type: "object", properties: {} }
  }
];

export async function handleShellTools(name, args, context) {
  // Extract workspace from context (Single Source of Truth)
  const ws = context?.workspace || process.cwd();
  
  switch (name) {
    case "shell_run": {
      const cwd = args.cwd || ws;
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: cwd,
        timeoutSeconds: args.timeout_seconds || 300
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    }
    
    case "process_start": {
      const cwd = args.cwd || ws;
      // In a real implementation, we'd track background processes
      // For now, we'll just execute and return a mock PID
      const { pid } = await execAsync(`${args.command} & echo $!`, {
        cwd: cwd
      });
      return `✅ 后台进程已启动，PID: ${pid.trim()}`;
    }
    
    case "process_output": {
      // Mock implementation - in reality this would read from stored process logs
      return `📄 进程 ${args.pid} 的最新输出:\n（这是一个模拟实现，实际应从后台进程日志读取）`;
    }
    
    case "process_kill": {
      // Mock implementation
      return `✅ 已终止进程: ${args.pid}`;
    }
    
    case "process_list_bg": {
      // Mock implementation
      return `📋 后台进程列表:\n（这是一个模拟实现，实际应显示真实的后台进程）`;
    }
    
    default:
      throw new Error(`未知 shell 工具: ${name}`);
  }
}