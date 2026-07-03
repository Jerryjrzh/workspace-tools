// src/tools/session.js
import { spawn } from 'child_process';

export const sessionTools = [
  {
    name: "ssh_session",
    description: "在独立 tmux window 中建立 SSH 连接，返回 pane 标识。后续用 tmux_send 发送命令，tmux_capture 读取输出。避免 sshpass 在子进程中的系统调用异常",
    inputSchema: {
      type: "object",
      properties: {
        host: { 
          type: "string", 
          description: "目标主机 IP 或域名" 
        },
        user: { 
          type: "string", 
          description: "SSH 用户名，默认 root" 
        },
        password: { 
          type: "string", 
          description: "SSH 密码（使用 sshpass）" 
        },
        port: { 
          type: "number", 
          description: "SSH 端口，默认 22" 
        },
        key_file: { 
          type: "string", 
          description: "SSH 私钥路径（与 password 二选一）" 
        },
        session: { 
          type: "string", 
          description: "tmux session，默认 '0'" 
        },
        window_name: { 
          type: "string", 
          description: "tmux window 名称，默认 'ssh-<host>'" 
        },
        extra_opts: { 
          type: "string", 
          description: "额外 SSH 选项，如 '-o ServerAliveInterval=30'" 
        }
      },
      required: ["host"]
    }
  },
  {
    name: "serial_session",
    description: "在独立 tmux window 中启动 minicom 串口会话，返回 pane 标识。后续用 tmux_send/tmux_capture 交互",
    inputSchema: {
      type: "object",
      properties: {
        device: { 
          type: "string", 
          description: "串口设备路径，默认 /dev/ttyUSB0" 
        },
        baud: { 
          type: "number", 
          description: "波特率，默认 115200" 
        },
        session: { 
          type: "string", 
          description: "tmux session，默认 '0'" 
        },
        window_name: { 
          type: "string", 
          description: "tmux window 名称，默认 'serial'" 
        },
        extra_opts: { 
          type: "string", 
          description: "额外 minicom 选项" 
        }
      }
    }
  }
];

export async function handleSessionTools(name, args, convId) {
  switch (name) {
    case "ssh_session": {
      try {
        // 在实际实现中，这里会建立SSH连接并在tmux窗口中运行
        const host = args.host;
        const user = args.user || 'root';
        const port = args.port || 22;
        const session = args.session || '0';
        const windowName = args.window_name || `ssh-${host.replace(/\\./g, '-')}`;
        
        return `🔗 SSH 连接已建立:\\n` +
               `(这是一个简化实现，实际应在独立 tmux window 中建立 SSH 连接)\\n` +
               `🖥️ 主机: ${host}\\n` +
               `👤 用户: ${user}\\n` +
               `🔐 端口: ${port}\\n` +
               `🪟 tmux pane: ${session}:${windowName}.0\\n` +
               (args.key_file ? `🔑 私钥文件: ${args.key_file}` : 
                args.password ? `🔒 使用密码认证` : `🔓 使用默认SSH认证`)+
               (args.extra_opts ? `\\n⚙️ 额外选项: ${args.extra_opts}` : '');
      } catch (error) {
        return `❌ SSH 会话建立失败: ${error.message}`;
      }
    }
    
    case "serial_session": {
      try {
        // 在实际实现中，这里会启动minicom串口会话并在tmux窗口中运行
        const device = args.device || '/dev/ttyUSB0';
        const baud = args.baud || 115200;
        const session = args.session || '0';
        const windowName = args.window_name || 'serial';
        
        return `🔌 串口会话已启动:\\n` +
               `(这是一个简化实现，实际应在独立 tmux window 中启动 minicom 串口会话)\\n` +
               `📱 设备: ${device}\\n` +
               `⚡ 波特率: ${baud}\\n` +
               `🪟 tmux window: ${session}:${windowName}`;
      } catch (error) {
        return `❌ 串口会话启动失败: ${error.message}`;
      }
    }
    
    default:
      throw new Error(`未知会话工具: ${name}`);
  }
}