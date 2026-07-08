// src/tools/env.js
import { execSync } from 'child_process';

export const envTools = [
  {
    name: "env_check",
    description: "检测命令、Python 模块或系统能力是否可用，在执行前预检依赖，避免运行时报错",
    inputSchema: {
      type: "object",
      properties: {
        commands: { 
          type: "array", 
          description: "要检测的命令列表，如 ['sshpass', 'tmux', 'minicom', 'expect']",
          items: { type: "string" }
        },
        python_modules: { 
          type: "array", 
          description: "要检测的 Python 模块列表，如 ['telnetlib', 'paramiko', 'pexpect']",
          items: { type: "string" }
        },
        ports: { 
          type: "array", 
          description: "要检测的端口连通性列表",
          items: {
            type: "object",
            properties: {
              host: { type: "string" },
              port: { type: "number" }
            }
          }
        }
      }
    }
  }
];

export async function handleEnvTools(name, args, convId) {
  switch (name) {
    case "env_check": {
      try {
        const results = { commands: {}, python_modules: {}, ports: {} };

        // 检查命令
        for (const cmd of (args.commands || [])) {
          try {
            const { stdout } = execSync(`which ${cmd} 2>/dev/null || echo missing`, { encoding: 'utf8' });
            results.commands[cmd] = stdout.includes("missing")
              ? { available: false, hint: `sudo apt-get install -y ${cmd}` }
              : { available: true, path: stdout.trim() };
          } catch {
            results.commands[cmd] = { available: false };
          }
        }

        // 检查Python模块
        for (const mod of (args.python_modules || [])) {
          try {
            const { stdout } = execSync(`python3 -c \"import ${mod}; print('ok')\" 2>/dev/null || echo missing`, { encoding: 'utf8' });
            results.python_modules[mod] = stdout.includes("missing")
              ? { available: false, hint: `pip install ${mod}` }
              : { available: true };
          } catch {
            results.python_modules[mod] = { available: false };
          }
        }

        // 检查端口连通性
        for (const { host, port } of (args.ports || [])) {
          try {
            const { stdout } = execSync(`nc -zv -w 3 ${host} ${port} 2>&1 && echo open || echo closed`, { encoding: 'utf8' });
            results.ports[`${host}:${port}`] = { open: stdout.includes("open") };
          } catch {
            results.ports[`${host}:${port}`] = { open: false };
          }
        }

        let out = "=== 环境检测结果 ===\\n";
        if (Object.keys(results.commands).length) {
          out += "\\n命令:\\n";
          for (const [cmd, r] of Object.entries(results.commands)) {
            const hint = r.hint || "";
            out += r.available ? `  ✅ ${cmd}: ${r.path}\n` : `  ❌ ${cmd}: 未安装  → ${hint}\n`;
          }
        }
        if (Object.keys(results.python_modules).length) {
          out += "\\nPython 模块:\\n";
          for (const [mod, r] of Object.entries(results.python_modules)) {
            const hint = r.hint || "";
            out += r.available ? `  ✅ ${mod}: 可用\n` : `  ❌ ${mod}: 不可用  → ${hint}\n`;
          }
        }
        if (Object.keys(results.ports).length) {
          out += "\\n端口连通性:\\n";
          for (const [target, r] of Object.entries(results.ports)) {
            out += r.open ? `  ✅ ${target}: 开放\\n` : `  ❌ ${target}: 不可达\\n`;
          }
        }
        return out;
      } catch (error) {
        return `❌ 环境检测失败: ${error.message}`;
      }
    }
    
    default:
      throw new Error(`未知环境工具: ${name}`);
  }
}