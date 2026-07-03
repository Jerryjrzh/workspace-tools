// src/tools/tmux.js
import { spawn } from 'child_process';

export const tmuxTools = [
  {
    name: "tmux_run",
    description: "在 tmux 中执行命令（新建 window 或指定 pane），命令在独立 tmux 环境中运行，避免系统调用异常。适合所有需要持久终端的操作",
    inputSchema: {
      type: "object",
      properties: {
        command: { 
          type: "string", 
          description: "要执行的命令" 
        },
        session: { 
          type: "string", 
          description: "tmux session 名，默认 '0'" 
        },
        window: { 
          type: "string", 
          description: "window 名称，不填则在当前 window 新建 pane" 
        },
        pane: { 
          type: "string", 
          description: "指定 pane（格式 session:window.pane），不填则新建" 
        },
        new_window: { 
          type: "boolean", 
          description: "是否新建 window，默认 false" 
        },
        wait: { 
          type: "boolean", 
          description: "是否等待命令执行完成并返回输出，默认 true" 
        },
        timeout_seconds: { 
          type: "number", 
          description: "等待超时秒数，默认 30" 
        }
      },
      required: ["command"]
    }
  },
  {
    name: "tmux_send",
    description: "向指定 tmux pane 发送按键或文本（不等待返回），适合交互式会话（SSH/minicom）中发送命令",
    inputSchema: {
      type: "object",
      properties: {
        pane: { 
          type: "string", 
          description: "目标 pane，格式 session:window.pane，如 '0:ssh.0'，默认 '0'" 
        },
        text: { 
          type: "string", 
          description: "要发送的文本" 
        },
        enter: { 
          type: "boolean", 
          description: "发送后是否追加回车，默认 true" 
        },
        keys: { 
          type: "string", 
          description: "发送特殊按键序列（tmux send-keys 格式），如 'C-c' 'q' 'Enter’，与 text 二选一" 
        }
      }
    }
  },
  {
    name: "tmux_capture",
    description: "读取 tmux pane 的当前屏幕内容或历史输出，用于获取命令执行结果",
    inputSchema: {
      type: "object",
      properties: {
        pane: { 
          type: "string", 
          description: "目标 pane，格式 session:window.pane，默认 '0'" 
        },
        lines: { 
          type: "number", 
          description: "读取最后 N 行，默认 50" 
        },
        start_line: { 
          type: "number", 
          description: "从第几行开始（负数表示从末尾，如 -100 表示最后 100 行）" 
        }
      }
    }
  },
  {
    name: "tmux_list",
    description: "列出所有 tmux session、window 和 pane",
    inputSchema: {
      type: "object",
      properties: {
        detail: { 
          type: "boolean", 
          description: "是否显示详细信息（包含 pane 列表），默认 true" 
        }
      }
    }
  },
  {
    name: "tmux_new_session",
    description: "创建新的 tmux session",
    inputSchema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "session 名称" 
        },
        cwd: { 
          type: "string", 
          description: "工作目录，默认 workspace" 
        },
        detach: { 
          type: "boolean", 
          description: "是否后台运行（detached），默认 true" 
        }
      },
      required: ["name"]
    }
  },
  {
    name: "tmux_kill",
    description: "关闭 tmux session、window 或 pane",
    inputSchema: {
      type: "object",
      properties: {
        target: { 
          type: "string", 
          description: "目标，格式：session 名 / session:window / session:window.pane" 
        },
        type: { 
          type: "string", 
          description: "session | window | pane，默认自动判断" 
        }
      },
      required: ["target"]
    }
  }
];

export async function handleTmuxTools(name, args, convId) {
  switch (name) {
    case "tmux_run": {
      try {
        // 构建 tmux 命令
        let tmuxCmd = ['tmux'];
        
        if (args.session) {
          tmuxCmd.push('-t');
          tmuxCmd.push(args.session);
        }
        
        if (args.new_window) {
          tmuxCmd.push('new-window');
        }
        
        // 在实际实现中，这里会使用child_process.spawn执行tmux命令
        // 但为了简化，我们返回一个说明性的消息
        
        return `💻 tmux 执行结果:\\n` +
               `(这是一个简化实现，实际应在 tmux 中执行命令)\\n` +
               `🖥️ 命令: ${args.command}\\n` +
               `📍 会话: ${args.session || '0'}\\n` +
               `🪟 窗口: ${args.window || '默认'}\\n` +
               `⏱️ 超时: ${args.timeout_seconds || 30}秒\\n` +
               `⏳ 等待完成: ${args.wait !== false}`;
      } catch (error) {
        return `❌ tmux 执行失败: ${error.message}`;
      }
    }
    
    case "tmux_send": {
      try {
        // 构建目标pane
        let targetPane = args.pane || '0';
        
        if (args.keys) {
          // 发送特殊按键
          return `📤 已发送特殊按键到 tmux:\\n` +
                 `(这是一个简化实现，实际应向 tmux pane 发送命令)\\n` +
                 `🎯 目标: ${targetPane}\\n` +
                 `⌨️ 按键: ${args.keys}`;
        } else {
          // 发送文本
          return `📤 已发送到 tmux:\\n` +
                 `(这是一个简化实现，实际应向 tmux pane 发送命令)\\n` +
                 `🎯 目标: ${targetPane}\\n` +
                 `💬 内容: ${args.text || ''}${args.enter ? '\\\\n' : ''}`;
        }
      } catch (error) {
        return `❌ tmux 发送失败: ${error.message}`;
      }
    }
    
    case "tmux_capture": {
      try {
        // 在实际实现中，这里会使用tmux capture-pane命令读取内容
        return `📥 tmux 捕获输出:\\n` +
               `(这是一个简化实现，实际应读取 tmux pane 的当前屏幕内容)\\n` +
               `👁️ 目标: ${args.pane || '0'}\\n` +
               `📏 行数: ${args.lines || 50}` +
               (args.start_line !== undefined ? `, 起始行: ${args.start_line}` : '');
      } catch (error) {
        return `❌ tmux 捕获失败: ${error.message}`;
      }
    }
    
    case "tmux_list": {
      try {
        // 在实际实现中，这里会使用tmux list-sessions等命令
        return `📋 tmux 会话列表:\\n` +
               `(这是一个简化实现，实际应列出所有 tmux session/window/pane)\\n` +
               `🔍 详细信息: ${args.detail !== false}`;
      } catch (error) {
        return `❌ tmux 列表失败: ${error.message}`;
      }
    }
    
    case "tmux_new_session": {
      try {
        // 在实际实现中，这里会使用tmux new-session命令
        return `✨ 新建 tmux 会话:\\n` +
               `(这是一个简化实现，实际应创建新的 tmux session)\\n` +
               `📝 名称: ${args.name}\\n` +
               `📂 工作目录: ${args.cwd || process.cwd()}\\n` +
               `🏃‍♂️ 后台运行: ${args.detach !== false}`;
      } catch (error) {
        return `❌ tmux 新建会话失败: ${error.message}`;
      }
    }
    
    case "tmux_kill": {
      try {
        // 在实际实现中，这里会使用tmux kill-session等命令
        return `❌ 已终止 tmux 目标:\\n` +
               `(这是一个简化实现，实际应关闭指定的 tmux session/window/pane)\\n` +
               `🎯 目标: ${args.target}\\n` +
               `🔧 类型: ${args.type || '自动判断'}`;
      } catch (error) {
        return `❌ tmux 终止失败: ${error.message}`;
      }
    }
    
    default:
      throw new Error(`未知 tmux 工具: ${name}`);
  }
}