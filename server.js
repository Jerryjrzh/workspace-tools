#!/usr/bin/env node
/**
 * LM Studio Workspace Tools MCP Server v1.5.0
 * - workspace 仅在当前会话内有效，不跨会话持久化
 * - 增强文本操作：patch、append、transform、diff
 * - 新增：find_files、workspace_tree、env_info、port_check、clipboard、json_query
 * v1.2.0 新增（按优先级）:
 *   P1: code_diagnostics — ruff/eslint/tsc 诊断
 *   P1: rg_search        — ripgrep 语义搜索
 *   P1: lm_chat          — 本地模型子任务调用
 *   P2: process_start/output/kill — 后台进程管理
 *   P2: symbol_search    — 代码符号搜索（基于 rg）
 *   P3: file_diff / file_apply_patch
 *   P3: project_knowledge_set/get
 * v1.3.0 新增（解决棘手问题）:
 *   FIX1: task_checkpoint/resume/list — 任务中断持久化恢复（解决执行中断问题）
 *   FIX1: context_anchor 扩展 persist/resume action
 *   FIX2: context_load/context_summary — 按需加载上下文（解决首次 prompt 过大问题）
 *   FIX2: self_check 增强，自动提示未完成持久化任务
 * v1.4.0 新增（深度扩展）:
 *   lm_embed + semantic_search — 本地向量语义搜索
 *   lm_review                 — 代码审查专用（lm_chat 高层封装）
 *   git_commit/branch/stash/log — git 操作补全
 *   http_request              — HTTP 调试工具
 *   workspace_snapshot/restore — 轻量快照
 *   template_render           — 模板渲染
 *   file_watch                — 文件变化监听
 * v1.5.0 新增（tmux 集成 + 环境检测）:
 *   tmux_run          — 在 tmux 中执行命令，避免系统调用异常
 *   tmux_send         — 向 tmux pane 发送命令/按键（交互式会话）
 *   tmux_capture      — 读取 tmux pane 输出
 *   tmux_list         — 列出所有 session/window/pane
 *   tmux_new_session  — 创建新 tmux session
 *   tmux_kill         — 关闭 session/window/pane
 *   ssh_session       — 在独立 tmux window 中建立 SSH 连接
 *   serial_session    — 在独立 tmux window 中启动 minicom 串口会话
 *   env_check         — 检测命令/Python模块/端口可用性，预检依赖
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import https from "https";

const execAsync = promisify(exec);

// ── 过滤模型内部思考块（Qwen3 / DeepSeek-R1 等带 thinking 模式的模型）────────
// 支持格式：<|channel>thought ... <channel|>  /  <think> ... </think>
// 同时过滤 <|turn>model 等 turn 分隔符 token
function stripThinkingBlocks(text) {
  return text
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|turn>\w+/g, "")   // 过滤 <|turn>model 等 turn token
    .replace(/<\|channel>\w+/g, "") // 过滤残留 channel token
    .trim();
}

// 从完整响应文本中提取所有 thinking 块内容（合并多块）
function extractThinkingBlocks(text) {
  const blocks = [];
  const re = /<\|channel>thought([\s\S]*?)<channel\|>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const content = m[1].trim();
    if (content) blocks.push(content);
  }
  // 同时支持 <think>...</think>
  const re2 = /<think>([\s\S]*?)<\/think>/g;
  while ((m = re2.exec(text)) !== null) {
    const content = m[1].trim();
    if (content) blocks.push(content);
  }
  return blocks.join("\n\n---\n\n");
}

// ── 后台进程管理（P2）────────────────────────────────────────────────────────
const bgProcesses = new Map(); // pid → { proc, logFile, cmd, startedAt }
let bgPidCounter = 1;

// ── 持久化 Terminal（环境隔离，source 一次全程有效）──────────────────────────
// 每个 terminal 是一个长驻 bash 进程，通过 stdin 写命令，stdout/stderr 读输出。
// 用 sentinel 标记命令结束，避免轮询。
const terminals = new Map(); // id → { proc, name, initCmd, createdAt, outputBuf }
let terminalIdCounter = 1;

function createTerminal(name, initCmd) {
  const id = terminalIdCounter++;
  const proc = spawn("/bin/bash", ["--norc", "--noprofile"], {
    cwd: getWorkspace(),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  const entry = { proc, name, initCmd: initCmd || "", createdAt: new Date().toISOString(), outputBuf: "" };
  proc.stdout.on("data", d => { entry.outputBuf += d.toString(); });
  proc.stderr.on("data", d => { entry.outputBuf += `[stderr] ${d.toString()}`; });
  proc.on("close", () => { terminals.delete(id); });
  terminals.set(id, entry);

  // 执行初始化命令（source 环境等）
  if (initCmd) {
    proc.stdin.write(`${initCmd}\n`);
  }
  return id;
}

async function termExec(id, cmd, timeoutMs = 300000) {
  const entry = terminals.get(id);
  if (!entry) throw new Error(`Terminal ${id} 不存在`);
  const sentinel = `__TERM_DONE_${Date.now()}__`;
  entry.outputBuf = ""; // 清空缓冲，只收本次输出
  // 写命令 + sentinel（sentinel 输出时表示命令执行完毕）
  entry.proc.stdin.write(`${cmd}\necho '${sentinel}'\n`);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`命令超时 (${timeoutMs/1000}s): ${cmd}`)), timeoutMs);
    const poll = setInterval(() => {
      if (entry.outputBuf.includes(sentinel)) {
        clearInterval(poll);
        clearTimeout(deadline);
        const out = entry.outputBuf.replace(new RegExp(`echo '${sentinel}'\\n?`), "")
                                   .replace(sentinel, "").trim();
        resolve(out);
      }
    }, 50);
  });
}

// ── Task Atomizer 常量 ────────────────────────────────────────────────────────
const TOKEN_BUDGET_DEFAULT = 800;
const TOKEN_BUDGET_MAX = 2000;

// ── Workspace 状态（仅进程内，不跨会话）─────────────────────────────────────
let currentWorkspace = null; // 每次启动都是 null，不从文件恢复

// MCP server 自身所在目录，用于防止文件操作意外落入插件目录
const SERVER_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname));

const workspaceHistoryFile = path.join(os.homedir(), ".lmstudio", ".internal", "workspace-history.json");

function loadHistory() {
  try {
    if (fs.existsSync(workspaceHistoryFile))
      return JSON.parse(fs.readFileSync(workspaceHistoryFile, "utf8"));
  } catch {}
  return { recent: [] };
}

function saveHistory(ws) {
  try {
    const h = loadHistory();
    h.recent = [ws, ...(h.recent || []).filter(p => p !== ws)].slice(0, 10);
    fs.mkdirSync(path.dirname(workspaceHistoryFile), { recursive: true });
    fs.writeFileSync(workspaceHistoryFile, JSON.stringify(h, null, 2));
  } catch {}
}

function setWorkspace(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) throw new Error(`路径不存在: ${resolved}`);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`不是目录: ${resolved}`);
  // 防止把插件目录本身设为 workspace
  if (resolved === SERVER_DIR || resolved.startsWith(SERVER_DIR + path.sep)) {
    throw new Error(`⛔ 禁止将 workspace-tools 插件目录设为 workspace: ${resolved}\n请指定你的项目目录。`);
  }
  currentWorkspace = resolved;
  saveHistory(resolved);
  return resolved;
}

// workspace 未设置时自动从历史恢复最近一个有效目录，实在没有才报错
function getWorkspace() {
  if (currentWorkspace) return currentWorkspace;

  // 尝试从历史自动恢复
  const recent = (loadHistory().recent || []);
  for (const p of recent) {
    if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()
        && p !== SERVER_DIR && !p.startsWith(SERVER_DIR + path.sep)) {
      currentWorkspace = p;
      console.error(`[workspace] 自动恢复上次 workspace: ${p}`);
      return p;
    }
  }

  // 历史全部无效，报错并给出明确提示
  throw new Error(
    `⚠️  Workspace 未设置且历史目录均不可用。\n` +
    `请调用 workspace_set(path="你的项目目录") 设置工作目录。\n` +
    `历史记录: ${recent.slice(0, 3).join(", ") || "（无记录）"}`
  );
}

// 只读操作（不写文件）允许 fallback，不强制要求设置 workspace
function getWorkspaceOrCwd() {
  return currentWorkspace || process.cwd();
}

// ── Workspace 工作日志 ────────────────────────────────────────────────────────
const WORKSPACE_LOG_FILE = ".lmstudio-workspace.json";
const LMSTUDIO_CONVERSATIONS_DIR = path.join(os.homedir(), ".lmstudio", "conversations");

function getWorkspaceLogPath(ws) {
  return path.join(ws || getWorkspace(), WORKSPACE_LOG_FILE);
}

function loadWorkspaceLog(ws) {
  try {
    const p = getWorkspaceLogPath(ws);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return { workspace: ws || getWorkspace(), sessions: [], notes: [] };
}

function saveWorkspaceLog(log, ws) {
  const p = getWorkspaceLogPath(ws);
  fs.writeFileSync(p, JSON.stringify(log, null, 2), "utf8");
}

// 从 LM Studio 对话文件中提取与该 workspace 相关的对话摘要
function extractConversationSummaries(ws, maxConversations = 5) {
  const summaries = [];
  try {
    const files = fs.readdirSync(LMSTUDIO_CONVERSATIONS_DIR)
      .filter(f => f.endsWith(".conversation.json"))
      .sort().reverse(); // 最新的在前

    for (const file of files) {
      if (summaries.length >= maxConversations) break;
      try {
        const conv = JSON.parse(fs.readFileSync(
          path.join(LMSTUDIO_CONVERSATIONS_DIR, file), "utf8"
        ));
        const messages = conv.messages || [];
        // 检查对话中是否提到了该 workspace 路径
        const convText = JSON.stringify(messages);
        if (!convText.includes(ws)) continue;

        // 提取用户消息文本
        const userMsgs = [];
        for (const msg of messages) {
          const ver = msg.versions?.[0];
          if (!ver) continue;
          if (ver.role === "user") {
            const text = ver.content?.find(c => c.type === "text")?.text || "";
            if (text.trim()) userMsgs.push(text.trim().slice(0, 200));
          }
        }
        if (userMsgs.length === 0) continue;

        summaries.push({
          file,
          name: conv.name || file,
          createdAt: conv.createdAt,
          model: conv.lastUsedModel?.split("/").pop() || "unknown",
          messageCount: messages.length,
          userMessages: userMsgs.slice(0, 5), // 最多5条用户消息
        });
      } catch {}
    }
  } catch {}
  return summaries;
}

// workspace_set 时自动加载历史并返回摘要
function buildWorkspaceSummary(ws) {
  const log = loadWorkspaceLog(ws);
  const convSummaries = extractConversationSummaries(ws);

  let summary = `✅ Workspace 已设置: ${ws}\n（仅本次会话有效）\n`;

  // 工作日志
  if (log.sessions && log.sessions.length > 0) {
    summary += `\n━━ 工作日志（共 ${log.sessions.length} 次会话）━━\n`;
    const recent = log.sessions.slice(-5); // 最近5次
    for (const s of recent) {
      summary += `\n[${s.date}] ${s.summary || "（无摘要）"}`;
      if (s.todos && s.todos.length > 0) {
        summary += `\n  待办: ${s.todos.join(" | ")}`;
      }
    }
    // 未完成的 notes
    const openNotes = (log.notes || []).filter(n => !n.done);
    if (openNotes.length > 0) {
      summary += `\n\n━━ 未完成事项 ━━\n`;
      openNotes.forEach(n => { summary += `  • ${n.text}\n`; });
    }
  } else {
    summary += `\n（该 workspace 暂无工作日志）\n`;
  }

  // LM Studio 对话历史
  if (convSummaries.length > 0) {
    summary += `\n━━ 相关对话历史（${convSummaries.length} 条）━━\n`;
    for (const c of convSummaries) {
      summary += `\n[${c.name}] ${c.model} · ${c.messageCount} 条消息\n`;
      c.userMessages.forEach(m => { summary += `  > ${m}\n`; });
    }
  }

  return summary;
}

function resolvePath(p) {
  const resolved = path.isAbsolute(p) ? p : path.join(getWorkspace(), p);
  // 防止路径意外落入插件目录
  if (resolved === SERVER_DIR || resolved.startsWith(SERVER_DIR + path.sep)) {
    throw new Error(
      `⛔ 路径解析到了 workspace-tools 插件目录，操作被拒绝: ${resolved}\n` +
      `请先调用 workspace_set() 设置正确的项目目录。`
    );
  }
  return resolved;
}

async function runCmd(cmd, cwd, timeoutMs = 30000) {
  // cwd 未传时用 getWorkspaceOrCwd()，避免 runCmd 内部报错影响只读操作
  const effectiveCwd = cwd || getWorkspaceOrCwd();
  const { stdout, stderr } = await execAsync(cmd, {
    cwd: effectiveCwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    shell: "/bin/bash",
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

// ── 工具定义 ─────────────────────────────────────────────────────────────────
const TOOLS = [
  // Workspace 管理
  { name: "workspace_set", description: "设置当前会话的工作目录。path=\"last\" 或 path=\"auto\" 可自动恢复上次使用的目录，无需记忆路径",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "目录绝对路径，或 \"last\"/\"auto\" 自动恢复上次 workspace" } }, required: ["path"] } },
  { name: "workspace_clear", description: "清除当前会话的 workspace 设置，恢复为进程 cwd",
    inputSchema: { type: "object", properties: {} } },
  { name: "workspace_info", description: "显示当前会话 workspace 路径及最近使用历史",
    inputSchema: { type: "object", properties: {} } },
  { name: "workspace_log_read", description: "读取当前 workspace 的完整工作日志和关联的 LM Studio 对话历史",
    inputSchema: { type: "object", properties: {
      max_conversations: { type: "number", description: "最多读取多少条关联对话，默认 5" }
    } } },
  { name: "workspace_log_add", description: "向当前 workspace 工作日志追加一条记录（进展、决策、问题等）",
    inputSchema: { type: "object", properties: {
      summary: { type: "string", description: "本次工作内容摘要" },
      todos: { type: "array", items: { type: "string" }, description: "待办事项列表" },
      notes: { type: "array", items: { type: "string" }, description: "备注/问题/决策" },
    }, required: ["summary"] } },
  { name: "workspace_session_end", description: "结束当前会话：将本次工作内容总结写入 workspace 日志，供下次会话参考",
    inputSchema: { type: "object", properties: {
      summary: { type: "string", description: "本次会话工作内容总结" },
      todos: { type: "array", items: { type: "string" }, description: "遗留待办事项" },
      completed: { type: "array", items: { type: "string" }, description: "本次已完成的事项" },
    }, required: ["summary"] } },
  { name: "workspace_note_done", description: "标记 workspace 中某条 note/待办为已完成",
    inputSchema: { type: "object", properties: {
      text: { type: "string", description: "要标记完成的 note 文本（模糊匹配）" }
    }, required: ["text"] } },
  { name: "workspace_ls", description: "列出 workspace 或子路径的文件",
    inputSchema: { type: "object", properties: {
      subpath: { type: "string" }, all: { type: "boolean", description: "显示隐藏文件" }
    } } },
  { name: "workspace_tree", description: "以树形结构显示目录（支持深度和忽略规则）",
    inputSchema: { type: "object", properties: {
      subpath: { type: "string" },
      depth: { type: "number", description: "最大深度，默认 3" },
      ignore: { type: "string", description: "忽略的目录名，逗号分隔，默认忽略 node_modules,.git,__pycache__" }
    } } },
  // 文件操作
  { name: "file_read", description: "读取文件内容，支持行范围",
    inputSchema: { type: "object", properties: {
      path: { type: "string" },
      start_line: { type: "number" }, end_line: { type: "number" }
    }, required: ["path"] } },
  { name: "file_write", description: "写入文件（覆盖或创建）。必须同时提供 path 和 content 两个参数，缺一不可。示例: file_write(path=\"src/foo.py\", content=\"print('hello')\")",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "文件路径（必填），相对于 workspace 根目录或绝对路径" },
      content: { type: "string", description: "文件内容（必填），写入的完整文本" }
    }, required: ["path", "content"] } },
  { name: "file_append", description: "追加内容到文件末尾。必须提供 path 和 content 两个参数",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "文件路径（必填）" },
      content: { type: "string", description: "要追加的内容（必填）" },
      newline: { type: "boolean", description: "追加前是否确保换行，默认 true" }
    }, required: ["path", "content"] } },
  { name: "file_patch", description: "精确替换文件中的指定文本（oldStr → newStr），不需要重写整个文件。必须提供 path、old_str、new_str 三个参数",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "文件路径（必填）" },
      old_str: { type: "string", description: "要被替换的原始文本（必填，需精确匹配）" },
      new_str: { type: "string", description: "替换后的新文本（必填）" },
      all: { type: "boolean", description: "是否替换所有匹配，默认只替换第一个" }
    }, required: ["path", "old_str", "new_str"] } },
  { name: "file_delete_lines", description: "删除文件中指定行范围",
    inputSchema: { type: "object", properties: {
      path: { type: "string" },
      start_line: { type: "number", description: "起始行（1-indexed）" },
      end_line: { type: "number", description: "结束行（1-indexed，含）" }
    }, required: ["path", "start_line", "end_line"] } },
  { name: "file_search", description: "在 workspace 中搜索文件内容（grep）",
    inputSchema: { type: "object", properties: {
      pattern: { type: "string" },
      file_pattern: { type: "string", description: "文件名 glob，如 '*.py'" },
      case_sensitive: { type: "boolean" },
      context_lines: { type: "number", description: "匹配行前后显示的上下文行数，默认 0" }
    }, required: ["pattern"] } },
  { name: "find_files", description: "按文件名/扩展名/大小/修改时间查找文件",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "文件名 glob，如 '*.log'" },
      newer_than: { type: "string", description: "比此文件更新（find -newer 语法）" },
      max_size: { type: "string", description: "最大文件大小，如 '10M'" },
      type: { type: "string", description: "f=文件 d=目录，默认 f" }
    } } },
  // 文本处理
  { name: "text_transform", description: "对文本内容做批量转换：正则替换、行过滤、排序、去重等",
    inputSchema: { type: "object", properties: {
      input: { type: "string", description: "输入文本（与 input_file 二选一）" },
      input_file: { type: "string", description: "输入文件路径" },
      operations: { type: "array", description: "操作列表，每项为 {op, ...params}",
        items: { type: "object", properties: {
          op: { type: "string", description: "操作类型: replace|filter|sort|uniq|upper|lower|trim|head|tail|count" }
        } } },
      output_file: { type: "string", description: "输出到文件（可选，不填则返回结果）" }
    } } },
  { name: "json_query", description: "对 JSON 文件或字符串执行 jq 查询",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "jq 表达式，如 '.[] | .name'" },
      input: { type: "string", description: "JSON 字符串（与 file 二选一）" },
      file: { type: "string", description: "JSON 文件路径" }
    }, required: ["query"] } },
  // 系统命令
  { name: "shell_run", description: "在 workspace 执行 bash 命令。",
    inputSchema: { type: "object", properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "执行目录，默认 workspace" },
      timeout_seconds: { type: "number", description: "默认 300" }
    }, required: ["command"] } },

  // ── 持久化 Terminal（环境保留，source 一次全程有效）──────────────────────
  { name: "terminal_create", description: "创建一个持久化 bash terminal，执行 init_cmd 初始化环境（如 source venv），后续命令通过 terminal_run 在同一进程执行，环境变量全程保留",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "terminal 名称，便于识别，如 'lmstudio-py'" },
      init_cmd: { type: "string", description: "初始化命令，如 'source /path/to/venv/bin/activate' 或 'conda activate myenv'" }
    }, required: ["name"] } },
  { name: "terminal_run", description: "在指定持久化 terminal 中执行命令，环境变量（venv、PATH 等）全程保留，无需重复 source",
    inputSchema: { type: "object", properties: {
      id: { type: "number", description: "terminal ID（terminal_create 返回）" },
      command: { type: "string", description: "要执行的命令" },
      timeout_seconds: { type: "number", description: "超时秒数，默认 30" }
    }, required: ["id", "command"] } },
  { name: "terminal_list", description: "列出所有活跃的持久化 terminal",
    inputSchema: { type: "object", properties: {} } },
  { name: "terminal_close", description: "关闭并销毁指定 terminal",
    inputSchema: { type: "object", properties: {
      id: { type: "number", description: "terminal ID" }
    }, required: ["id"] } },
  { name: "process_list", description: "列出进程（支持过滤）",
    inputSchema: { type: "object", properties: { filter: { type: "string" } } } },
  { name: "port_check", description: "检查端口占用情况",
    inputSchema: { type: "object", properties: {
      port: { type: "number", description: "指定端口，不填则列出所有监听端口" }
    } } },
  { name: "env_info", description: "查看环境变量（支持过滤）",
    inputSchema: { type: "object", properties: { filter: { type: "string", description: "关键词过滤" } } } },
  { name: "system_info", description: "获取 CPU/内存/磁盘信息",
    inputSchema: { type: "object", properties: {} } },
  { name: "gpu_info", description: "获取 GPU 信息和显存使用（AMD Vulkan/共享内存）",
    inputSchema: { type: "object", properties: {} } },
  // Git
  { name: "git_status", description: "git status + 最近 commits",
    inputSchema: { type: "object", properties: {} } },
  { name: "git_diff", description: "查看 git diff。",
    inputSchema: { type: "object", properties: {
      staged: { type: "boolean" }, file: { type: "string" }
    } } },
  // LM Studio
  { name: "lmstudio_model_perf", description: "分析 LM Studio 模型性能瓶颈并给出优化建议",
    inputSchema: { type: "object", properties: {} } },
  // 幻觉检测与验证
  { name: "verify_file_exists", description: "验证文件或目录是否真实存在",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "要验证的文件或目录路径" },
      check_content: { type: "string", description: "可选：同时验证文件内容是否包含此字符串" }
    }, required: ["path"] } },
  { name: "verify_command_output", description: "执行命令并验证输出是否符合预期，用于确认上一步操作是否真实生效",
    inputSchema: { type: "object", properties: {
      command: { type: "string", description: "验证用的命令" },
      expected_contains: { type: "string", description: "期望输出中包含的字符串" },
      expected_not_contains: { type: "string", description: "期望输出中不包含的字符串" },
      cwd: { type: "string" }
    }, required: ["command"] } },
  { name: "hallucination_check", description: "对模型上一步的输出或声明进行事实核查。传入模型声称做了什么，工具会验证是否属实并返回真实状态",
    inputSchema: { type: "object", properties: {
      claim: { type: "string", description: "模型声称完成的操作描述，如'已写入文件 foo.py'、'已安装依赖 requests'" },
      verify_commands: { type: "array", description: "用于核查的命令列表",
        items: { type: "object", properties: {
          cmd: { type: "string" },
          expect: { type: "string", description: "期望包含的输出" }
        } } }
    }, required: ["claim", "verify_commands"] } },
  { name: "context_anchor", description: "在长对话中设置上下文锚点：记录当前任务目标、已完成步骤、待完成步骤，防止模型在长上下文中迷失或重复",
    inputSchema: { type: "object", properties: {
      action: { type: "string", description: "set=设置锚点 | get=读取当前锚点 | update_done=标记步骤完成 | reset=清除 | persist=持久化到磁盘 | resume=从磁盘恢复" },
      goal: { type: "string", description: "任务总目标（action=set 时使用）" },
      steps: { type: "array", description: "任务步骤列表", items: { type: "string" } },
      done_index: { type: "number", description: "标记第几步完成（0-indexed，action=update_done 时使用）" },
      task_id: { type: "string", description: "任务唯一标识，用于跨会话恢复（可选，默认自动生成）" }
    }, required: ["action"] } },
  { name: "self_check", description: "模型自检工具：列出当前会话状态（workspace、锚点、最近操作记录），帮助模型在迷失时重新定位",
    inputSchema: { type: "object", properties: {} } },

  // ── 任务中断恢复（解决问题2）─────────────────────────────────────────────
  { name: "task_checkpoint", description: "保存任务执行检查点到磁盘，session 中断后可用 task_resume 恢复。每完成一个子步骤后调用",
    inputSchema: { type: "object", properties: {
      task_id: { type: "string", description: "任务唯一 ID（同一任务保持一致）" },
      goal: { type: "string", description: "任务总目标描述" },
      steps: { type: "array", description: "完整步骤列表",
        items: { type: "object", properties: {
          index: { type: "number" },
          text: { type: "string" },
          status: { type: "string", description: "pending | running | done | failed" },
          result: { type: "string", description: "执行结果摘要（可选）" }
        } } },
      current_step: { type: "number", description: "当前执行到第几步（0-indexed）" },
      context: { type: "object", description: "任意需要跨会话保留的上下文数据（文件路径、变量值等）" }
    }, required: ["task_id", "goal", "steps"] } },
  { name: "task_resume", description: "从磁盘恢复上次中断的任务状态，返回任务目标、已完成步骤、下一步待执行内容",
    inputSchema: { type: "object", properties: {
      task_id: { type: "string", description: "要恢复的任务 ID（不填则列出所有未完成任务）" }
    } } },
  { name: "task_list", description: "列出所有持久化的任务（包括已完成和未完成）",
    inputSchema: { type: "object", properties: {
      status: { type: "string", description: "all | pending | done（默认 pending）" }
    } } },

  // ── 首次 Prompt 瘦身（解决问题1）────────────────────────────────────────
  { name: "context_load", description: "按需加载指定的上下文文件（SOUL/AGENTS/USER/TOOLS等），只在需要时加载，避免每次全量注入",
    inputSchema: { type: "object", properties: {
      files: { type: "array", items: { type: "string" },
        description: "要加载的文件名列表，如 ['SOUL.md','USER.md']，相对于 workspace 根目录" },
      summarize: { type: "boolean", description: "是否用 lm_chat 压缩摘要后返回（节省 token），默认 false" },
      max_chars: { type: "number", description: "每个文件最多返回字符数，默认不限制" }
    }, required: ["files"] } },
  { name: "context_summary", description: "生成当前 workspace 的精简上下文摘要（替代全量加载 SOUL+AGENTS），用于新会话快速定位。自动读取 PROGRESS.md 进度状态",
    inputSchema: { type: "object", properties: {
      include_tasks: { type: "boolean", description: "是否包含未完成任务，默认 true" },
      include_knowledge: { type: "boolean", description: "是否包含项目知识库摘要，默认 true" },
      max_tokens_hint: { type: "number", description: "目标输出字符数上限，默认 800" }
    } } },

  // ── progress_sync：同步 PROGRESS.md 到 workspace log ─────────────────────
  { name: "progress_sync", description: "读取 PROGRESS.md（或指定进度文件），统计任务完成状态并同步到 workspace 工作日志。每次会话开始时调用，避免状态过期",
    inputSchema: { type: "object", properties: {
      progress_file: { type: "string", description: "进度文件名，默认 PROGRESS.md，相对于 workspace 根目录" }
    } } },

  // ── session_start：会话启动时一键恢复状态（核心入口）────────────────────
  { name: "session_start", description: "获取当前项目的运行状态。读取当前 Conversation 会话日志与 workspace 状态，对齐并提取最新的任务进度摘要，以实现无缝恢复。",
    inputSchema: { type: "object", properties: {
      include_progress: { type: "boolean", description: "是否读取 PROGRESS.md，默认 true" }
    } } },

  // ── session_summarize：会话结束时主动压缩状态 ───────────────────
  { name: "session_summarize", description: "【会话开始和结束时调用】将当前会话状态（已完成步骤、待执行内容、关键上下文）压缩写入持久化文件。新会话通过 session_start 读取此摘要直接恢复执行，无需重新生成 token",
    inputSchema: { type: "object", properties: {
      completed: { type: "array", items: { type: "string" }, description: "本次会话已完成的操作列表" },
      next_task: { type: "string", description: "下一步需要执行的具体任务描述（越详细越好）" },
      next_task_context: { type: "string", description: "执行下一步所需的关键上下文（文件路径、变量值、错误信息等）" },
      blockers: { type: "array", items: { type: "string" }, description: "当前阻塞问题列表" },
      plan_id: { type: "string", description: "关联的 task_plan ID（如有）" },
      step_id: { type: "string", description: "关联的当前步骤 ID（如有）" }
    }, required: ["next_task"] } },

  // ── P1: code_diagnostics ──────────────────────────────────────────────────
  { name: "code_diagnostics", description: "获取文件的语法/类型/lint 错误，自动选择工具（ruff/eslint/tsc/mypy），对齐 Kiro getDiagnostics",
    inputSchema: { type: "object", properties: {
      paths: { type: "array", items: { type: "string" }, description: "文件路径列表（相对或绝对）" },
      tool: { type: "string", description: "auto | ruff | eslint | tsc | mypy | pylint（默认 auto）" }
    }, required: ["paths"] } },

  // ── P1: rg_search ─────────────────────────────────────────────────────────
  { name: "rg_search", description: "用 ripgrep 搜索代码（比 grep 快 10x，自动忽略 .gitignore，支持正则）",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "搜索模式（正则或字面量）" },
      include: { type: "string", description: "文件 glob，如 '**/*.py' 或 '*.ts'" },
      exclude: { type: "string", description: "排除 glob，如 'node_modules'" },
      context_lines: { type: "number", description: "前后上下文行数，默认 2" },
      case_sensitive: { type: "boolean", description: "默认 false（忽略大小写）" },
      fixed_strings: { type: "boolean", description: "字面量搜索（不解析正则），默认 false" },
      max_results: { type: "number", description: "最多返回结果数，默认 50" },
      subpath: { type: "string", description: "搜索子目录，默认 workspace 根" }
    }, required: ["query"] } },

  // ── P1: lm_chat ───────────────────────────────────────────────────────────
  { name: "lm_chat", description: "调用本地 LM Studio 模型执行子任务。thinking 内容自动落盘到本地文件，只返回纯输出，避免重复展示。长任务通过 progress notification 持续重置 MCP 超时，不会因生成时间长而中断。",
    inputSchema: { type: "object", properties: {
      prompt: { type: "string", description: "用户消息" },
      system: { type: "string", description: "系统提示词（可选）" },
      model: { type: "string", description: "模型 ID，默认使用当前加载的模型" },
      max_tokens: { type: "number", description: "最大输出 token 数，默认 4096 （代码生成或長篇 Review 請顯式宣為 4096）" },
      temperature: { type: "number", description: "温度，默认 0.3" },
      frequency_penalty: { type: "number", description: "重复惩罚（0~2），默认 0.5" },
      presence_penalty: { type: "number", description: "话题多样性（0~2），默认 0.3" },
      stop: { type: "array", items: { type: "string" }, description: "停止序列" },
      base_url: { type: "string", description: "LM Studio API 地址，默认 http://127.0.0.1:12340" },
      enable_thinking: { type: "boolean", description: "是否启用 thinking 模式，默认 true（thinking 落盘不展示）" },
      thinking_id: { type: "string", description: "thinking 记录 ID，默认自动生成，可指定以便后续 lm_thinking_read 读取" }
    }, required: ["prompt"] } },

  // ── lm_thinking_read：从本地读取 thinking 记录 ───────────────────────────
  { name: "lm_thinking_read", description: "读取 lm_chat 保存的本地 thinking 记录，供后续操作工具直接使用，无需模型重复叙述",
    inputSchema: { type: "object", properties: {
      thinking_id: { type: "string", description: "thinking 记录 ID（lm_chat 返回的 thinking_id=xxx），不填则列出最近记录" },
      section: { type: "string", enum: ["thinking", "output", "all"], description: "返回内容：thinking=思考过程 output=最终输出 all=全部，默认 thinking" },
      limit: { type: "number", description: "列出最近 N 条记录，默认 10" }
    } } },

  // ── session_recover：从 conversation 文件恢复 thinking 内容 ──────────────
  { name: "session_recover", description: "从 LM Studio conversation 文件恢复 thinking 内容。thinking 写入失败时的终极兜底，conversation 文件保留完整 session 记录",
    inputSchema: { type: "object", properties: {
      action: { type: "string", enum: ["list", "extract"], description: "list=列出最近会话 extract=提取指定会话的 thinking，默认 list" },
      conv_id: { type: "string", description: "conversation ID（文件名前缀）或名称关键词，不填则取最新会话" },
      last_n: { type: "number", description: "只取最近 N 条 thinking 块，默认全部" },
      max_chars: { type: "number", description: "每条 thinking 最多显示字符数，默认 500" },
      save: { type: "boolean", description: "是否将恢复的 thinking 写入 ~/.lmstudio/.thinking/ 供 lm_thinking_read 使用，默认 false" },
      limit: { type: "number", description: "list 时显示最近 N 条，默认 10" }
    } } },

  // ── session_continue：从 conversation 日志分析中断状态，提炼待执行内容 ──
  { name: "session_continue", description: "收到 continue 时调用。从最新 conversation 日志分析中断前的状态：提取最后 thinking、失败的工具调用、待执行内容，自动恢复 workspace，输出结构化的继续执行方案",
    inputSchema: { type: "object", properties: {
      conv_id: { type: "string", description: "指定 conversation ID，不填则取最新会话" },
      scan_msgs: { type: "number", description: "扫描最近 N 条消息，默认 20" }
    } } },
  // ── P2: 后台进程管理 ──────────────────────────────────────────────────────
  { name: "process_start", description: "后台启动长时间运行的命令（构建、服务器、监控等），立即返回进程 ID",
    inputSchema: { type: "object", properties: {
      command: { type: "string", description: "要执行的命令" },
      cwd: { type: "string", description: "执行目录，默认 workspace" },
      label: { type: "string", description: "进程标签，便于识别" }
    }, required: ["command"] } },
  { name: "process_output", description: "读取后台进程的最新输出日志",
    inputSchema: { type: "object", properties: {
      pid: { type: "number", description: "process_start 返回的进程 ID" },
      lines: { type: "number", description: "读取最后 N 行，默认 50" }
    }, required: ["pid"] } },
  { name: "process_kill", description: "终止后台进程",
    inputSchema: { type: "object", properties: {
      pid: { type: "number", description: "process_start 返回的进程 ID" }
    }, required: ["pid"] } },
  { name: "process_list_bg", description: "列出所有后台进程及其状态",
    inputSchema: { type: "object", properties: {} } },

  // ── P2: symbol_search ─────────────────────────────────────────────────────
  { name: "symbol_search", description: "在 workspace 中搜索代码符号定义（函数/类/方法），基于 ripgrep 模式匹配",
    inputSchema: { type: "object", properties: {
      symbol: { type: "string", description: "符号名称（支持部分匹配）" },
      type: { type: "string", description: "function | class | method | all（默认 all）" },
      language: { type: "string", description: "python | javascript | typescript | go | rust | all（默认 auto 检测）" }
    }, required: ["symbol"] } },

  // ── P3: file_diff / file_apply_patch ──────────────────────────────────────
  { name: "file_diff", description: "生成两个文件或文本之间的 unified diff",
    inputSchema: { type: "object", properties: {
      path_a: { type: "string", description: "原始文件路径（或留空配合 text_a）" },
      path_b: { type: "string", description: "新文件路径（或留空配合 text_b）" },
      text_a: { type: "string", description: "原始文本（与 path_a 二选一）" },
      text_b: { type: "string", description: "新文本（与 path_b 二选一）" },
      context_lines: { type: "number", description: "上下文行数，默认 3" }
    } } },
  { name: "file_apply_patch", description: "将 unified diff patch 应用到文件",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "目标文件路径" },
      patch: { type: "string", description: "unified diff 内容" },
      dry_run: { type: "boolean", description: "仅预览不实际修改，默认 false" }
    }, required: ["path", "patch"] } },

  // ── P3: project_knowledge ─────────────────────────────────────────────────
  { name: "project_knowledge_set", description: "记录项目级知识到持久化知识库（架构决策、约定、禁忌、关键路径等）",
    inputSchema: { type: "object", properties: {
      key: { type: "string", description: "知识条目的唯一键，如 'arch.db', 'convention.naming'" },
      content: { type: "string", description: "知识内容" },
      tags: { type: "array", items: { type: "string" }, description: "标签，便于分类检索" }
    }, required: ["key", "content"] } },
  { name: "project_knowledge_get", description: "读取项目知识库，支持按 key 精确查询或按 tag/关键词模糊检索",
    inputSchema: { type: "object", properties: {
      key: { type: "string", description: "精确 key（可选）" },
      tag: { type: "string", description: "按标签过滤（可选）" },
      search: { type: "string", description: "关键词搜索（可选）" }
    } } },
  { name: "project_knowledge_delete", description: "删除项目知识库中的某条记录",
    inputSchema: { type: "object", properties: {
      key: { type: "string" }
    }, required: ["key"] } },

  // ── v1.4.0: lm_embed + semantic_search ───────────────────────────────────
  { name: "lm_embed", description: "用本地 embedding 模型对文本列表做向量化，结果存入 workspace 向量库",
    inputSchema: { type: "object", properties: {
      texts: { type: "array", items: { type: "string" }, description: "要向量化的文本列表" },
      ids: { type: "array", items: { type: "string" }, description: "每条文本的唯一 ID（可选，默认自动生成）" },
      collection: { type: "string", description: "向量库集合名，默认 'default'" },
      model: { type: "string", description: "embedding 模型 ID，默认 text-embedding-nomic-embed-text-v1.5" },
      base_url: { type: "string", description: "LM Studio API 地址，默认 http://127.0.0.1:12340" }
    }, required: ["texts"] } },
  { name: "semantic_search", description: "在本地向量库中做语义相似度搜索，找到最相关的文本片段",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "查询文本" },
      collection: { type: "string", description: "向量库集合名，默认 'default'" },
      top_k: { type: "number", description: "返回最相似的 K 条，默认 5" },
      model: { type: "string", description: "embedding 模型 ID" },
      base_url: { type: "string" }
    }, required: ["query"] } },
  { name: "embed_files", description: "将 workspace 中的文件内容分块向量化，建立语义索引（支持代码/文档）",
    inputSchema: { type: "object", properties: {
      include: { type: "string", description: "文件 glob，如 '**/*.py'，默认 '**/*.{py,js,ts,md}'" },
      collection: { type: "string", description: "集合名，默认 workspace 名" },
      chunk_size: { type: "number", description: "每块字符数，默认 500" },
      model: { type: "string" },
      base_url: { type: "string" }
    } } },

  // ── v1.4.0: lm_review ────────────────────────────────────────────────────
  { name: "lm_review", description: "用本地模型对代码/文本做专项审查（安全、性能、可读性、逻辑等），返回结构化建议",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "要审查的文件路径（与 content 二选一）" },
      content: { type: "string", description: "直接传入代码内容" },
      focus: { type: "string", description: "审查重点: security | performance | readability | logic | all（默认 all）" },
      language: { type: "string", description: "代码语言（可选，自动检测）" },
      model: { type: "string" },
      base_url: { type: "string" }
    } } },

  // ── v1.4.0: git 操作补全 ──────────────────────────────────────────────────
  { name: "git_commit", description: "执行 git add + commit，支持自动生成 commit message（调用本地模型）",
    inputSchema: { type: "object", properties: {
      message: { type: "string", description: "commit message（留空则调用本地模型自动生成）" },
      files: { type: "array", items: { type: "string" }, description: "要 add 的文件列表，默认 ['.']（全部）" },
      auto_message: { type: "boolean", description: "是否用本地模型自动生成 commit message，默认 false" }
    } } },
  { name: "git_branch", description: "git 分支操作：列出/创建/切换/删除分支",
    inputSchema: { type: "object", properties: {
      action: { type: "string", description: "list | create | checkout | delete | current" },
      name: { type: "string", description: "分支名（create/checkout/delete 时必填）" },
      base: { type: "string", description: "基础分支（create 时可选）" }
    }, required: ["action"] } },
  { name: "git_stash", description: "git stash 操作：保存/恢复/列出/删除暂存",
    inputSchema: { type: "object", properties: {
      action: { type: "string", description: "push | pop | list | drop | show" },
      message: { type: "string", description: "stash 描述（push 时可选）" },
      index: { type: "number", description: "stash 索引（pop/drop/show 时可选，默认 0）" }
    }, required: ["action"] } },
  { name: "git_log", description: "查看 git 提交历史，支持过滤和格式化",
    inputSchema: { type: "object", properties: {
      limit: { type: "number", description: "显示条数，默认 20" },
      author: { type: "string", description: "按作者过滤" },
      since: { type: "string", description: "起始时间，如 '2 weeks ago'" },
      file: { type: "string", description: "只看某文件的历史" },
      oneline: { type: "boolean", description: "单行格式，默认 true" }
    } } },

  // ── v1.4.0: http_request ─────────────────────────────────────────────────
  { name: "http_request", description: "发送 HTTP 请求（调试 API、测试 webhook、获取远程数据等）",
    inputSchema: { type: "object", properties: {
      url: { type: "string", description: "请求 URL" },
      method: { type: "string", description: "GET | POST | PUT | DELETE | PATCH，默认 GET" },
      headers: { type: "object", description: "请求头 key-value 对象" },
      body: { type: "string", description: "请求体（POST/PUT 时使用）" },
      json: { type: "object", description: "JSON 请求体（自动设置 Content-Type: application/json）" },
      timeout_seconds: { type: "number", description: "超时秒数，默认 30" },
      follow_redirects: { type: "boolean", description: "是否跟随重定向，默认 true" }
    }, required: ["url"] } },

  // ── v1.4.0: workspace_snapshot / restore ─────────────────────────────────
  { name: "workspace_snapshot", description: "对 workspace 关键文件做轻量快照（比 git stash 更快，不需要 git）",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "快照名称，默认时间戳" },
      include: { type: "string", description: "文件 glob，默认 '**/*.{py,js,ts,json,yaml,toml,md}'" },
      exclude: { type: "string", description: "排除 glob，默认 'node_modules,__pycache__,.git'" },
      note: { type: "string", description: "快照备注" }
    } } },
  { name: "workspace_restore", description: "从快照恢复文件",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "快照名称（留空则列出所有快照）" },
      files: { type: "array", items: { type: "string" }, description: "只恢复指定文件（留空则恢复全部）" },
      dry_run: { type: "boolean", description: "仅预览不实际恢复，默认 false" }
    } } },

  // ── v1.4.0: template_render ──────────────────────────────────────────────
  { name: "template_render", description: "渲染模板字符串或模板文件，支持变量替换和简单逻辑（Mustache 风格）",
    inputSchema: { type: "object", properties: {
      template: { type: "string", description: "模板字符串（与 template_file 二选一）" },
      template_file: { type: "string", description: "模板文件路径" },
      vars: { type: "object", description: "变量 key-value 对象" },
      output_file: { type: "string", description: "输出到文件（可选）" }
    } } },

  // ── v1.4.0: file_watch ───────────────────────────────────────────────────
  { name: "file_watch", description: "监听文件或目录变化，记录变更事件（轮询模式，适合短时监控）",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "监听路径（文件或目录）" },
      duration_seconds: { type: "number", description: "监听时长（秒），默认 10，最大 60" },
      include: { type: "string", description: "文件 glob 过滤" }
    }, required: ["path"] } },

  // ── Task Atomizer（任务强制原子化）────────────────────────────────────────
  { name: "task_plan_register", description: "【核心編排】註原子任務計劃，將 多步重型任務（如全局 Review、架構重建）分解為 token 受限的原子步驟並持久化，避免顯卡 Context Overflow 或超時！",
    inputSchema: { type: "object", properties: {
      plan_id: { type: "string", description: "计划唯一 ID" },
      goal: { type: "string", description: "总目标描述" },
      steps: { type: "array", description: "步骤列表",
        items: { type: "object", properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          token_budget: { type: "number", description: "预期输出 token 数（≤ 2000）" }
        }, required: ["id", "title", "description", "token_budget"] } }
    }, required: ["plan_id", "goal", "steps"] } },

  { name: "task_plan_get", description: "查询指定计划的详情及每步当前执行状态",
    inputSchema: { type: "object", properties: {
      plan_id: { type: "string", description: "计划唯一 ID" }
    }, required: ["plan_id"] } },

  { name: "task_plan_list", description: "列出所有原子任务计划，支持按状态过滤",
    inputSchema: { type: "object", properties: {
      status: { type: "string", enum: ["active", "completed", "all"], description: "过滤状态，默认 active" }
    } } },

  { name: "task_step_start", description: "啟計劃中下一個待執行步驟（Step Gate 入口）。模型在執行每一個耗時任務前，必須啟用此工具明確上下文界限。",
    inputSchema: { type: "object", properties: {
      plan_id: { type: "string", description: "计划唯一 ID" },
      step_id: { type: "string", description: "指定步骤 ID（不填则取下一个 pending/failed 步骤）" }
    }, required: ["plan_id"] } },

  { name: "task_step_done", description: "确认步骤完成（Step Gate 出口），更新状态并返回下一步信息",
    inputSchema: { type: "object", properties: {
      plan_id: { type: "string", description: "计划唯一 ID" },
      step_id: { type: "string", description: "步骤 ID" },
      result_summary: { type: "string", description: "步骤执行结果摘要（≤ 200 字符）" },
      status: { type: "string", enum: ["done", "failed", "skipped"], description: "步骤完成状态" }
    }, required: ["plan_id", "step_id", "result_summary", "status"] } },

  { name: "task_decompose_check", description: "分解守卫预检：验证 proposed_steps 的 token 预算是否符合原子化要求（≤ 800）",
    inputSchema: { type: "object", properties: {
      proposed_steps: { type: "array", description: "待检查的步骤列表",
        items: { type: "object", properties: {
          title: { type: "string" },
          estimated_tokens: { type: "number" }
        }, required: ["title", "estimated_tokens"] } }
    }, required: ["proposed_steps"] } },

  // ── v1.5.0: tmux 集成 ────────────────────────────────────────────────────
  { name: "tmux_run", description: "在 tmux 中执行命令（新建 window 或指定 pane），命令在独立 tmux 环境中运行，避免系统调用异常。适合所有需要持久终端的操作",
    inputSchema: { type: "object", properties: {
      command: { type: "string", description: "要执行的命令" },
      session: { type: "string", description: "tmux session 名，默认 '0'" },
      window: { type: "string", description: "window 名称，不填则在当前 window 新建 pane" },
      pane: { type: "string", description: "指定 pane（格式 session:window.pane），不填则新建" },
      new_window: { type: "boolean", description: "是否新建 window，默认 false" },
      wait: { type: "boolean", description: "是否等待命令执行完成并返回输出，默认 true" },
      timeout_seconds: { type: "number", description: "等待超时秒数，默认 30" }
    }, required: ["command"] } },

  { name: "tmux_send", description: "向指定 tmux pane 发送按键或文本（不等待返回），适合交互式会话（SSH/minicom）中发送命令",
    inputSchema: { type: "object", properties: {
      pane: { type: "string", description: "目标 pane，格式 session:window.pane，如 '0:ssh.0'，默认 '0'" },
      text: { type: "string", description: "要发送的文本" },
      enter: { type: "boolean", description: "发送后是否追加回车，默认 true" },
      keys: { type: "string", description: "发送特殊按键序列（tmux send-keys 格式），如 'C-c' 'q' 'Enter'，与 text 二选一" }
    } } },

  { name: "tmux_capture", description: "读取 tmux pane 的当前屏幕内容或历史输出，用于获取命令执行结果",
    inputSchema: { type: "object", properties: {
      pane: { type: "string", description: "目标 pane，格式 session:window.pane，默认 '0'" },
      lines: { type: "number", description: "读取最后 N 行，默认 50" },
      start_line: { type: "number", description: "从第几行开始（负数表示从末尾，如 -100 表示最后 100 行）" }
    } } },

  { name: "tmux_list", description: "列出所有 tmux session、window 和 pane",
    inputSchema: { type: "object", properties: {
      detail: { type: "boolean", description: "是否显示详细信息（包含 pane 列表），默认 true" }
    } } },

  { name: "tmux_new_session", description: "创建新的 tmux session",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: "session 名称" },
      cwd: { type: "string", description: "工作目录，默认 workspace" },
      detach: { type: "boolean", description: "是否后台运行（detached），默认 true" }
    }, required: ["name"] } },

  { name: "tmux_kill", description: "关闭 tmux session、window 或 pane",
    inputSchema: { type: "object", properties: {
      target: { type: "string", description: "目标，格式：session 名 / session:window / session:window.pane" },
      type: { type: "string", description: "session | window | pane，默认自动判断" }
    }, required: ["target"] } },

  // ── v1.5.0: SSH 会话（tmux 隔离）────────────────────────────────────────
  { name: "ssh_session", description: "在独立 tmux window 中建立 SSH 连接，返回 pane 标识。后续用 tmux_send 发送命令，tmux_capture 读取输出。避免 sshpass 在子进程中的系统调用异常",
    inputSchema: { type: "object", properties: {
      host: { type: "string", description: "目标主机 IP 或域名" },
      user: { type: "string", description: "SSH 用户名，默认 root" },
      password: { type: "string", description: "SSH 密码（使用 sshpass）" },
      port: { type: "number", description: "SSH 端口，默认 22" },
      key_file: { type: "string", description: "SSH 私钥路径（与 password 二选一）" },
      session: { type: "string", description: "tmux session，默认 '0'" },
      window_name: { type: "string", description: "tmux window 名称，默认 'ssh-<host>'" },
      extra_opts: { type: "string", description: "额外 SSH 选项，如 '-o ServerAliveInterval=30'" }
    }, required: ["host"] } },

  // ── v1.5.0: Serial 会话（tmux 隔离）─────────────────────────────────────
  { name: "serial_session", description: "在独立 tmux window 中启动 minicom 串口会话，返回 pane 标识。后续用 tmux_send/tmux_capture 交互",
    inputSchema: { type: "object", properties: {
      device: { type: "string", description: "串口设备路径，默认 /dev/ttyUSB0" },
      baud: { type: "number", description: "波特率，默认 115200" },
      session: { type: "string", description: "tmux session，默认 '0'" },
      window_name: { type: "string", description: "tmux window 名称，默认 'serial'" },
      extra_opts: { type: "string", description: "额外 minicom 选项" }
    } } },

  // ── v1.5.0: env_check ────────────────────────────────────────────────────
  { name: "env_check", description: "检测命令、Python 模块或系统能力是否可用，在执行前预检依赖，避免运行时报错",
    inputSchema: { type: "object", properties: {
      commands: { type: "array", items: { type: "string" }, description: "要检测的命令列表，如 ['sshpass', 'tmux', 'minicom', 'expect']" },
      python_modules: { type: "array", items: { type: "string" }, description: "要检测的 Python 模块列表，如 ['telnetlib', 'paramiko', 'pexpect']" },
      ports: { type: "array", description: "要检测的端口连通性列表",
        items: { type: "object", properties: {
          host: { type: "string" }, port: { type: "number" }
        } } }
    } } },
  { 
    name: "load_global_rules", 
    description: "读取全局 Agent 行为规范和任务操作红线。",
    inputSchema: { type: "object", properties: {} } 
  },

  { 
    name: "load_task_rules", 
    description: "加载特定任务的规则文件（如 coding, review, debug 等）。",
    inputSchema: { type: "object", properties: {
      task: { type: "string", description: "任务类型，例如 'coding', 'review', 'debug' 等" }
    }, required: ["task"] } 
  },
];

// ── 会话状态（幻觉检测用）────────────────────────────────────────────────────
const sessionState = {
  anchor: null,          // context_anchor 设置的任务锚点
  opLog: [],             // 最近操作记录（最多保留 20 条）
};

// ── 任务持久化路径 ────────────────────────────────────────────────────────────
const TASKS_DIR = path.join(os.homedir(), ".lmstudio", ".internal", "tasks");

function logOp(name, args, result) {
  sessionState.opLog.push({
    time: new Date().toISOString(),
    tool: name,
    summary: typeof result === "string" ? result.slice(0, 120) : "",
  });
  if (sessionState.opLog.length > 20) sessionState.opLog.shift();
}

// ── 工具处理器 ────────────────────────────────────────────────────────────────
async function handleTool(name, args, extra = {}) {
  // 统一校验必填参数，防止模型生成不完整的 tool call 导致崩溃
  const toolDef = TOOLS.find(t => t.name === name);
  if (toolDef) {
    const required = toolDef.inputSchema?.required || [];
    const missing = required.filter(k => args[k] === undefined || args[k] === null || args[k] === "");
    if (missing.length > 0) {
      return `❌ 参数缺失: ${name} 需要 [${missing.join(", ")}]，请重新调用并提供所有必填参数。\n` +
             `当前收到的参数: ${JSON.stringify(args)}`;
    }
  }

  switch (name) {

    case "workspace_set": {
      // 支持 path="last" 快捷恢复上次 workspace
      let targetPath = args.path;
      if (targetPath === "last" || targetPath === "auto") {
        const recent = (loadHistory().recent || []);
        const valid = recent.find(p => p && fs.existsSync(p) && fs.statSync(p).isDirectory()
          && p !== SERVER_DIR && !p.startsWith(SERVER_DIR + path.sep));
        if (!valid) return `❌ 无可用的历史 workspace 记录`;
        targetPath = valid;
      }
      const resolved = setWorkspace(targetPath);
      return buildWorkspaceSummary(resolved);
    }

    case "workspace_clear": {
      const prev = currentWorkspace;
      currentWorkspace = null;
      return `✅ 已清除 workspace 设置${prev ? `（原: ${prev}）` : ""}，当前使用进程 cwd: ${process.cwd()}`;
    }

    case "workspace_info": {
      const ws = getWorkspaceOrCwd();
      const isSet = currentWorkspace !== null;
      const h = loadHistory();
      let info = `当前 Workspace: ${ws} ${isSet ? "（本会话已设置）" : "（⚠️  未设置，当前为插件 cwd，文件操作会报错）"}\n`;
      if (!isSet) info += `→ 请调用 workspace_set(path="你的项目目录") 后再执行任务\n`;
      try { info += `目录大小: ${(await runCmd("du -sh . 2>/dev/null | cut -f1", ws)).stdout}\n`; } catch {}
      info += `\n最近使用历史:\n`;
      (h.recent || []).forEach((p, i) => { info += `  ${i + 1}. ${p}${p === ws ? " ← 当前" : ""}\n`; });
      return info;
    }

    case "workspace_log_read": {
      const ws = getWorkspace();
      const log = loadWorkspaceLog(ws);
      const convs = extractConversationSummaries(ws, args.max_conversations || 5);
      let out = `━━ Workspace 工作日志: ${ws} ━━\n`;
      if (log.sessions?.length > 0) {
        out += `\n共 ${log.sessions.length} 次会话记录:\n`;
        for (const s of log.sessions) {
          out += `\n[${s.date}] ${s.summary}`;
          if (s.completed?.length) out += `\n  ✅ 完成: ${s.completed.join(", ")}`;
          if (s.todos?.length) out += `\n  📌 待办: ${s.todos.join(", ")}`;
          if (s.notes?.length) out += `\n  📝 备注: ${s.notes.join(", ")}`;
        }
      } else {
        out += "\n（暂无会话记录）\n";
      }
      const openNotes = (log.notes || []).filter(n => !n.done);
      if (openNotes.length > 0) {
        out += `\n\n━━ 未完成事项 ━━\n`;
        openNotes.forEach(n => { out += `  • [${n.date}] ${n.text}\n`; });
      }
      if (convs.length > 0) {
        out += `\n━━ 关联 LM Studio 对话（${convs.length} 条）━━\n`;
        for (const c of convs) {
          out += `\n📄 ${c.name} | ${c.model} | ${c.messageCount} 条消息\n`;
          c.userMessages.forEach(m => { out += `   > ${m}\n`; });
        }
      }
      return out;
    }

    case "workspace_log_add": {
      const ws = getWorkspace();
      const log = loadWorkspaceLog(ws);
      const entry = {
        date: new Date().toISOString().slice(0, 19).replace("T", " "),
        summary: args.summary,
        todos: args.todos || [],
        notes: args.notes || [],
      };
      log.sessions = log.sessions || [];
      log.sessions.push(entry);
      // 同步 notes 到顶层未完成列表
      for (const n of (args.notes || [])) {
        log.notes = log.notes || [];
        log.notes.push({ text: n, date: entry.date, done: false });
      }
      saveWorkspaceLog(log, ws);
      return `✅ 已记录到 ${ws}/${WORKSPACE_LOG_FILE}\n摘要: ${args.summary}`;
    }

    case "workspace_session_end": {
      const ws = getWorkspace();
      const log = loadWorkspaceLog(ws);
      const entry = {
        date: new Date().toISOString().slice(0, 19).replace("T", " "),
        summary: args.summary,
        completed: args.completed || [],
        todos: args.todos || [],
      };
      log.sessions = log.sessions || [];
      log.sessions.push(entry);
      // 标记已完成的 notes
      for (const done of (args.completed || [])) {
        (log.notes || []).forEach(n => {
          if (!n.done && n.text.includes(done)) n.done = true;
        });
      }
      // 新增待办到 notes
      for (const todo of (args.todos || [])) {
        log.notes = log.notes || [];
        if (!log.notes.find(n => !n.done && n.text === todo)) {
          log.notes.push({ text: todo, date: entry.date, done: false });
        }
      }
      saveWorkspaceLog(log, ws);
      return `✅ 会话已归档到 ${ws}/${WORKSPACE_LOG_FILE}\n摘要: ${args.summary}\n下次进入此 workspace 时将自动显示此记录。`;
    }

    case "workspace_note_done": {
      const ws = getWorkspace();
      const log = loadWorkspaceLog(ws);
      let matched = 0;
      (log.notes || []).forEach(n => {
        if (!n.done && n.text.includes(args.text)) { n.done = true; matched++; }
      });
      saveWorkspaceLog(log, ws);
      return matched > 0 ? `✅ 已标记 ${matched} 条为完成` : `未找到匹配的未完成事项: "${args.text}"`;
    }

    case "workspace_ls": {
      const target = args.subpath ? path.join(getWorkspace(), args.subpath) : getWorkspace();
      if (!fs.existsSync(target)) {
        const parentDir = path.dirname(target);
        let suggestions = "";
        // 顺便帮模型看一眼父目录里有什么
        if (fs.existsSync(parentDir)) {
          const files = fs.readdirSync(parentDir).slice(0, 15).join(", ");
          suggestions = `\n💡 提示: 父目录包含以下内容，请检查是否拼写错误:\n[${files}]`;
        }
        return `❌ 路径不存在: ${target}${suggestions}`;
      }
      const { stdout } = await runCmd(`ls ${args.all ? "-la" : "-l"} --color=never`, target);
      return `📁 ${target}\n\n${stdout}`;
    }

    case "workspace_tree": {
      const target = args.subpath ? path.join(getWorkspace(), args.subpath) : getWorkspace();
      if (!fs.existsSync(target)) {
        const parentDir = path.dirname(target);
        let suggestions = "";
        // 顺便帮模型看一眼父目录里有什么
        if (fs.existsSync(parentDir)) {
          const files = fs.readdirSync(parentDir).slice(0, 15).join(", ");
          suggestions = `\n💡 提示: 父目录包含以下内容，请检查是否拼写错误:\n[${files}]`;
        }
        return `❌ 路径不存在: ${target}${suggestions}`;
      }
      const depth = args.depth || 3;
      const ignore = args.ignore || "node_modules,.git,__pycache__,.venv,dist,build";
      const ignoreArgs = ignore.split(",").map(d => `-I "${d.trim()}"`).join(" ");
      try {
        const { stdout } = await runCmd(`tree -L ${depth} ${ignoreArgs} --noreport 2>/dev/null || find . -maxdepth ${depth} | sort | sed 's|[^/]*/|  |g'`, target);
        return `📂 ${target}\n\n${stdout}`;
      } catch {
        const { stdout } = await runCmd(`find . -maxdepth ${depth} | sort`, target);
        return `📂 ${target}\n\n${stdout}`;
      }
    }

    case "file_read": {
      const fp = resolvePath(args.path);
      const lines = fs.readFileSync(fp, "utf8").split("\n");
      const start = (args.start_line || 1) - 1;
      const end = args.end_line || lines.length;
      return `📄 ${fp} (行 ${start + 1}-${Math.min(end, lines.length)} / 共 ${lines.length} 行)\n\n${lines.slice(start, end).join("\n")}`;
    }

    case "file_write": {
      const fp = resolvePath(args.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, args.content, "utf8");
      return `✅ 已写入: ${fp} (${Buffer.byteLength(args.content, "utf8")} bytes)`;
    }

    case "file_append": {
      const fp = resolvePath(args.path);
      const addNewline = args.newline !== false;
      let existing = "";
      try { existing = fs.readFileSync(fp, "utf8"); } catch {}
      const prefix = (addNewline && existing.length > 0 && !existing.endsWith("\n")) ? "\n" : "";
      fs.appendFileSync(fp, prefix + args.content, "utf8");
      return `✅ 已追加到: ${fp} (+${Buffer.byteLength(args.content, "utf8")} bytes)`;
    }

    case "file_patch": {
      const fp = resolvePath(args.path);
      let content = fs.readFileSync(fp, "utf8");
      if (!content.includes(args.old_str))
        throw new Error(`未找到匹配文本: ${args.old_str.slice(0, 80)}...`);
      const count = args.all
        ? (content.split(args.old_str).length - 1)
        : 1;
      content = args.all
        ? content.split(args.old_str).join(args.new_str)
        : content.replace(args.old_str, args.new_str);
      fs.writeFileSync(fp, content, "utf8");
      return `✅ 已替换 ${count} 处: ${fp}`;
    }

    case "file_delete_lines": {
      const fp = resolvePath(args.path);
      const lines = fs.readFileSync(fp, "utf8").split("\n");
      const s = args.start_line - 1, e = args.end_line;
      const removed = e - s;
      lines.splice(s, removed);
      fs.writeFileSync(fp, lines.join("\n"), "utf8");
      return `✅ 已删除第 ${args.start_line}-${args.end_line} 行（共 ${removed} 行）: ${fp}`;
    }

    case "file_search": {
      const ctx = args.context_lines ? `-C ${args.context_lines}` : "";
      const ci = args.case_sensitive ? "" : "-i";
      const ff = args.file_pattern ? `--include="${args.file_pattern}"` : "";
      const pat = args.pattern.replace(/"/g, '\\"');
      const { stdout } = await runCmd(`grep -rn ${ci} ${ctx} ${ff} "${pat}" . 2>/dev/null | head -100`, getWorkspace());
      return stdout || "未找到匹配内容";
    }

    case "find_files": {
      const parts = ["find ."];
      if (args.type) parts.push(`-type ${args.type}`); else parts.push("-type f");
      if (args.name) parts.push(`-name "${args.name}"`);
      if (args.newer_than) parts.push(`-newer "${args.newer_than}"`);
      if (args.max_size) parts.push(`-size -${args.max_size}`);
      parts.push("2>/dev/null | head -100");
      const { stdout } = await runCmd(parts.join(" "), getWorkspace());
      return stdout || "未找到匹配文件";
    }

    case "text_transform": {
      let text = args.input || "";
      if (args.input_file) text = fs.readFileSync(resolvePath(args.input_file), "utf8");
      for (const op of (args.operations || [])) {
        switch (op.op) {
          case "replace": text = text.split(op.from).join(op.to); break;
          case "replace_regex": text = text.replace(new RegExp(op.pattern, op.flags || "g"), op.to || ""); break;
          case "filter": text = text.split("\n").filter(l => l.includes(op.contains || "")).join("\n"); break;
          case "filter_regex": text = text.split("\n").filter(l => new RegExp(op.pattern).test(l)).join("\n"); break;
          case "exclude": text = text.split("\n").filter(l => !l.includes(op.contains || "")).join("\n"); break;
          case "sort": { const ls = text.split("\n"); ls.sort(); text = ls.join("\n"); break; }
          case "sort_reverse": { const ls = text.split("\n"); ls.sort().reverse(); text = ls.join("\n"); break; }
          case "uniq": text = [...new Set(text.split("\n"))].join("\n"); break;
          case "upper": text = text.toUpperCase(); break;
          case "lower": text = text.toLowerCase(); break;
          case "trim": text = text.split("\n").map(l => l.trim()).join("\n"); break;
          case "head": text = text.split("\n").slice(0, op.n || 10).join("\n"); break;
          case "tail": text = text.split("\n").slice(-(op.n || 10)).join("\n"); break;
          case "count": return `行数: ${text.split("\n").length}\n字符数: ${text.length}`;
        }
      }
      if (args.output_file) {
        fs.writeFileSync(resolvePath(args.output_file), text, "utf8");
        return `✅ 已写入: ${args.output_file}`;
      }
      return text;
    }

    case "json_query": {
      const input = args.file
        ? fs.readFileSync(resolvePath(args.file), "utf8")
        : args.input || "{}";
      const q = args.query.replace(/'/g, "'\\''");
      const { stdout } = await runCmd(`echo '${input.replace(/'/g, "'\\''")}' | jq '${q}'`, "/tmp");
      return stdout;
    }

    case "shell_run": {
      const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspace();
      const { stdout, stderr } = await runCmd(args.command, cwd, (args.timeout_seconds || 300) * 1000);
      let output = [`$ ${args.command}`, stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n");
      // MCP 通訊防暴截斷，保護前端 Electron/V8 內存不溢出
      const MAX_OUTPUT_LENGTH = 50000;
      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.substring(0, MAX_OUTPUT_LENGTH) +
                 `\n\n...[⚠️ Output Truncated: 輸出超過 ${MAX_OUTPUT_LENGTH} 字元，為防止前端崩潰已強制截斷。 請修改你的命令，使用重定向(>)或管道(| grep/head)！]`;
      }
      return output;
    }

    // ── 持久化 Terminal ──────────────────────────────────────────────────────
    case "terminal_create": {
      const id = createTerminal(args.name, args.init_cmd);
      // 等待初始化命令执行完（最多 15s）
      let initResult = "";
      if (args.init_cmd) {
        try { initResult = await termExec(id, "echo '__init_ok__'", 15000); } catch {}
      }
      return [
        `✅ Terminal [${id}] "${args.name}" 已创建`,
        args.init_cmd ? `初始化: ${args.init_cmd}` : "（无初始化命令）",
        initResult ? `初始化输出: ${initResult}` : "",
        `\n用 terminal_run(id=${id}, command="...") 执行命令`,
      ].filter(Boolean).join("\n");
    }

    case "terminal_run": {
      const out = await termExec(args.id, args.command, (args.timeout_seconds || 30) * 1000);
      const entry = terminals.get(args.id);
      return `[terminal:${args.id}${entry ? ` "${entry.name}"` : ""}] $ ${args.command}\n${out}`;
    }

    case "terminal_list": {
      if (terminals.size === 0) return "当前无活跃 terminal\n用 terminal_create 创建一个";
      let out = `活跃 Terminal (${terminals.size} 个):\n\n`;
      for (const [id, t] of terminals) {
        out += `[${id}] "${t.name}" — 创建于 ${t.createdAt.slice(0,16)}\n`;
        if (t.initCmd) out += `  init: ${t.initCmd}\n`;
      }
      return out;
    }

    case "terminal_close": {
      const entry = terminals.get(args.id);
      if (!entry) return `❌ Terminal ${args.id} 不存在`;
      entry.proc.stdin.end();
      entry.proc.kill("SIGTERM");
      terminals.delete(args.id);
      return `✅ Terminal [${args.id}] "${entry.name}" 已关闭`;
    }

    case "process_list": {
      const cmd = args.filter
        ? `ps aux | grep -i "${args.filter}" | grep -v grep`
        : `ps aux --sort=-%cpu | head -20`;
      const { stdout } = await runCmd(cmd, "/tmp");
      return stdout || "无匹配进程";
    }

    case "port_check": {
      const cmd = args.port
        ? `ss -tlnp | grep ':${args.port}' || echo "端口 ${args.port} 未被占用"`
        : `ss -tlnp`;
      const { stdout } = await runCmd(cmd, "/tmp");
      return stdout;
    }

    case "env_info": {
      const { stdout } = await runCmd(
        args.filter ? `env | grep -i "${args.filter}"` : `env | sort`,
        "/tmp"
      );
      return stdout || "无匹配环境变量";
    }

    case "system_info": {
      const [mem, cpu, disk, load] = await Promise.all([
        runCmd("free -h").catch(() => ({ stdout: "N/A" })),
        runCmd("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2").catch(() => ({ stdout: "N/A" })),
        runCmd("df -h / /home 2>/dev/null").catch(() => ({ stdout: "N/A" })),
        runCmd("uptime").catch(() => ({ stdout: "N/A" })),
      ]);
      return `CPU:${cpu.stdout}\n负载: ${load.stdout}\n\n内存:\n${mem.stdout}\n\n磁盘:\n${disk.stdout}`;
    }

    case "gpu_info": {
      let info = "=== GPU 信息 ===\n";
      // AMD APU 共享内存
      for (const card of ["card0", "card1"]) {
        try {
          const total = parseInt(fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_total`, "utf8"));
          const used = parseInt(fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_used`, "utf8"));
          info += `${card} VRAM: ${(used/1e9).toFixed(2)} GB / ${(total/1e9).toFixed(2)} GB\n`;
        } catch {}
      }
      // Vulkan 共享内存堆
      try {
        const { stdout } = await runCmd("vulkaninfo 2>/dev/null | grep -A4 'memoryHeaps\\|deviceName\\|deviceType' | head -40", "/tmp");
        info += `\nVulkan:\n${stdout}`;
      } catch {}
      return info;
    }

    case "git_status": {
      const ws = getWorkspace();
      const [st, log, branch] = await Promise.all([
        runCmd("git status --short", ws).catch(() => ({ stdout: "非 git 仓库" })),
        runCmd("git log --oneline -10", ws).catch(() => ({ stdout: "" })),
        runCmd("git branch --show-current", ws).catch(() => ({ stdout: "" })),
      ]);
      return `📋 Git (${ws})\n分支: ${branch.stdout}\n\n${st.stdout}\n\n最近提交:\n${log.stdout}`;
    }

    case "git_diff": {
      const { stdout } = await runCmd(
        `git diff ${args.staged ? "--staged" : ""} ${args.file ? `-- "${args.file}"` : ""}`,
        getWorkspace()
      );
      return stdout || "无变更";
    }

    case "lmstudio_model_perf": {
      const memInfo = fs.readFileSync("/proc/meminfo", "utf8");
      const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)?.[1] || 0) * 1024;
      const memAvail = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)?.[1] || 0) * 1024;
      let report = `=== LM Studio 性能分析 ===\n`;
      report += `系统内存: ${((memTotal-memAvail)/1e9).toFixed(1)} / ${(memTotal/1e9).toFixed(1)} GB 已用\n`;
      for (const card of ["card0", "card1"]) {
        try {
          const t = parseInt(fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_total`, "utf8"));
          const u = parseInt(fs.readFileSync(`/sys/class/drm/${card}/device/mem_info_vram_used`, "utf8"));
          report += `${card} VRAM: ${(u/1e9).toFixed(2)} / ${(t/1e9).toFixed(2)} GB\n`;
        } catch {}
      }
      report += `\n当前模型: gemma-4-31B bf16 (~65 GB)\n`;
      report += `后端: llama.cpp Vulkan (AMD Radeon 8060S APU，共享内存)\n\n`;
      report += `✅ 优化建议:\n`;
      report += `  1. 换 Q4_K_M 量化版 (~18 GB)，速度提升 3-5x\n`;
      report += `  2. Context length 设为 8192（当前过大导致 OOM）\n`;
      report += `  3. 启动时设 GGML_VK_HEAP_SIZE=68719476736 强制 Vulkan 使用 64GB 共享内存\n`;
      report += `  4. GPU Offload Layers 设为 max，让 APU 共享内存承载模型\n`;
      report += `  5. 关闭其他大内存程序，确保 >80 GB 可用\n`;
      return report;
    }

    case "verify_file_exists": {
      const fp = resolvePath(args.path);
      const exists = fs.existsSync(fp);
      if (!exists) return `❌ 不存在: ${fp}\n⚠️  模型可能产生了路径幻觉，请重新确认实际路径`;
      const stat = fs.statSync(fp);
      let result = `✅ 存在: ${fp}\n类型: ${stat.isDirectory() ? "目录" : "文件"}\n大小: ${stat.size} bytes\n修改时间: ${stat.mtime.toISOString()}`;
      if (args.check_content && stat.isFile()) {
        const content = fs.readFileSync(fp, "utf8");
        const found = content.includes(args.check_content);
        result += `\n内容包含 "${args.check_content}": ${found ? "✅ 是" : "❌ 否（内容与预期不符）"}`;
      }
      return result;
    }

    case "verify_command_output": {
      const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspace();
      let stdout = "", stderr = "";
      try {
        ({ stdout, stderr } = await runCmd(args.command, cwd));
      } catch (e) {
        return `❌ 命令执行失败: ${e.message}`;
      }
      const output = stdout + stderr;
      let result = `$ ${args.command}\n${output}\n`;
      if (args.expected_contains) {
        const ok = output.includes(args.expected_contains);
        result += `\n期望包含 "${args.expected_contains}": ${ok ? "✅ 通过" : "❌ 未找到 — 操作可能未生效"}`;
      }
      if (args.expected_not_contains) {
        const ok = !output.includes(args.expected_not_contains);
        result += `\n期望不含 "${args.expected_not_contains}": ${ok ? "✅ 通过" : "❌ 仍然存在 — 操作可能未生效"}`;
      }
      return result;
    }

    case "hallucination_check": {
      const results = [];
      results.push(`核查声明: "${args.claim}"\n`);
      let allPassed = true;
      for (const { cmd, expect } of (args.verify_commands || [])) {
        let out = "";
        let cmdFailed = false;
        try {
          const r = await runCmd(cmd, getWorkspace());
          out = r.stdout + r.stderr;
        } catch (e) { out = e.message; cmdFailed = true; }
        // 命令本身失败时直接判定为未通过
        const passed = cmdFailed ? false : (expect ? out.includes(expect) : out.length > 0);
        allPassed = allPassed && passed;
        results.push(`  $ ${cmd}`);
        results.push(`  输出: ${out.slice(0, 200)}`);
        results.push(`  验证 "${expect}": ${passed ? "✅ 通过" : "❌ 失败"}\n`);
      }
      results.push(allPassed
        ? "✅ 核查通过，声明属实，可以继续"
        : "❌ 核查失败，模型声明与实际不符，请重新执行相关步骤");
      return results.join("\n");
    }

    case "context_anchor": {
      switch (args.action) {
        case "set": {
          sessionState.anchor = {
            task_id: args.task_id || `task-${Date.now()}`,
            goal: args.goal || "",
            steps: (args.steps || []).map((s, i) => ({ index: i, text: s, done: false })),
            createdAt: new Date().toISOString(),
          };
          
          // 自动落盘
          fs.mkdirSync(TASKS_DIR, { recursive: true });
          const taskFile = path.join(TASKS_DIR, `${sessionState.anchor.task_id}.json`);
          const payload = { ...sessionState.anchor, workspace: getWorkspace(), updatedAt: new Date().toISOString() };
          fs.writeFileSync(taskFile, JSON.stringify(payload, null, 2));

          return `✅ 锚点已设置并自动落盘 [${sessionState.anchor.task_id}]\n目标: ${sessionState.anchor.goal}\n步骤:\n${sessionState.anchor.steps.map(s => `  [ ] ${s.index + 1}. ${s.text}`).join("\n")}`;
        }

        case "get": {
          if (!sessionState.anchor) return "⚠️  当前会话未设置锚点，建议用 context_anchor(set) 设置任务目标";
          const a = sessionState.anchor;
          const stepLines = a.steps.map(s => `  [${s.done ? "✅" : "  "}] ${s.index + 1}. ${s.text}`).join("\n");
          const done = a.steps.filter(s => s.done).length;
          return `📌 任务锚点 [${a.task_id}]\n目标: ${a.goal}\n进度: ${done}/${a.steps.length}\n\n${stepLines}`;
        }

        case "update_done": {
          if (!sessionState.anchor) throw new Error("未设置锚点");
          const step = sessionState.anchor.steps[args.done_index];
          if (!step) throw new Error(`步骤 ${args.done_index} 不存在`);
          step.done = true;
          
          // 自动落盘同步最新进度
          fs.mkdirSync(TASKS_DIR, { recursive: true });
          const taskFile = path.join(TASKS_DIR, `${sessionState.anchor.task_id}.json`);
          const payload = { ...sessionState.anchor, workspace: getWorkspace(), updatedAt: new Date().toISOString() };
          fs.writeFileSync(taskFile, JSON.stringify(payload, null, 2));

          const remaining = sessionState.anchor.steps.filter(s => !s.done);
          return `✅ 步骤 ${args.done_index + 1} 已完成并同步至磁盘: "${step.text}"\n下一步: ${remaining[0] ? remaining[0].text : "全部完成"}`;
        }

        case "persist": {
          if (!sessionState.anchor) throw new Error("未设置锚点，无法持久化");
          fs.mkdirSync(TASKS_DIR, { recursive: true });
          const taskFile = path.join(TASKS_DIR, `${sessionState.anchor.task_id}.json`);
          const payload = { ...sessionState.anchor, workspace: getWorkspace(), updatedAt: new Date().toISOString() };
          fs.writeFileSync(taskFile, JSON.stringify(payload, null, 2));
          return `✅ 锚点已手动持久化: ${taskFile}`;
        }

        case "resume": {
          if (!args.task_id) throw new Error("resume 需要提供 task_id");
          const taskFile = path.join(TASKS_DIR, `${args.task_id}.json`);
          if (!fs.existsSync(taskFile)) return `❌ 未找到任务: ${args.task_id}`;
          sessionState.anchor = JSON.parse(fs.readFileSync(taskFile, "utf8"));
          const ra = sessionState.anchor;
          const rdone = ra.steps.filter(s => s.done).length;
          const rnext = ra.steps.find(s => !s.done);
          return `✅ 锚点已从磁盘恢复 [${ra.task_id}]\n目标: ${ra.goal}\n进度: ${rdone}/${ra.steps.length}\n下一步: ${rnext ? `步骤${rnext.index + 1}: ${rnext.text}` : "全部完成"}`;
        }

        case "reset": {
          sessionState.anchor = null;
          return "✅ 锚点已清除";
        }

        default:
          throw new Error(`未知 action: ${args.action}`);
      
      }
    }

    case "self_check": {
      const ws = getWorkspace();
      const isSet = currentWorkspace !== null;
      let report = `=== 当前会话状态 ===\n`;
      report += `Workspace: ${ws} ${isSet ? "（已设置）" : "（未设置，使用 cwd）"}\n`;
      if (sessionState.anchor) {
        const a = sessionState.anchor;
        const done = a.steps.filter(s => s.done).length;
        report += `\n任务锚点 [${a.task_id || "未命名"}]: ${a.goal}\n进度: ${done}/${a.steps.length} 步完成\n`;
        const next = a.steps.find(s => !s.done);
        if (next) report += `当前应执行: 步骤${next.index + 1} — ${next.text}\n`;
      } else {
        report += `\n任务锚点: 未设置\n`;
        // 自动提示是否有未完成的持久化任务
        try {
          if (fs.existsSync(TASKS_DIR)) {
            const pending = fs.readdirSync(TASKS_DIR)
              .filter(f => f.endsWith(".json"))
              .map(f => JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")))
              .filter(t => t.steps?.some(s => !s.done));
            if (pending.length > 0) {
              report += `\n⚠️  发现 ${pending.length} 个未完成的持久化任务:\n`;
              pending.forEach(t => {
                const done = t.steps.filter(s => s.done).length;
                report += `  • [${t.task_id}] ${t.goal} (${done}/${t.steps.length})\n`;
              });
              report += `  → 用 task_resume(task_id=...) 恢复执行\n`;
            }
          }
        } catch {}
      }
      if (sessionState.opLog.length > 0) {
        report += `\n最近操作记录 (${sessionState.opLog.length} 条):\n`;
        sessionState.opLog.slice(-5).forEach(op => {
          report += `  [${op.time.slice(11, 19)}] ${op.tool}: ${op.summary}\n`;
        });
      }
      // 追加活跃 Task_Plan 摘要
      try {
        if (fs.existsSync(TASKS_DIR)) {
          const activePlans = fs.readdirSync(TASKS_DIR)
            .filter(f => f.startsWith("plan_") && f.endsWith(".json"))
            .map(f => { try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")); } catch { return null; } })
            .filter(p => p && p.status === "active");
          if (activePlans.length > 0) {
            report += `\n活跃任务计划 (${activePlans.length} 个):\n`;
            activePlans.forEach(p => {
              const done = p.steps.filter(s => s.status === "done" || s.status === "skipped").length;
              report += `  • [${p.plan_id}] ${p.goal} (${done}/${p.steps.length})\n`;
            });
          }
        }
      } catch {}
      return report;
    }

    // ── 任务中断恢复 ─────────────────────────────────────────────────────────
    case "task_checkpoint": {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
      const taskFile = path.join(TASKS_DIR, `${args.task_id}.json`);
      const allDone = args.steps.every(s => s.status === "done");
      const payload = {
        task_id: args.task_id,
        goal: args.goal,
        steps: args.steps,
        current_step: args.current_step ?? args.steps.findIndex(s => s.status !== "done"),
        context: args.context || {},
        workspace: getWorkspace(),
        status: allDone ? "done" : "pending",
        createdAt: fs.existsSync(taskFile)
          ? JSON.parse(fs.readFileSync(taskFile, "utf8")).createdAt
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(taskFile, JSON.stringify(payload, null, 2));
      const doneCount = args.steps.filter(s => s.status === "done").length;
      const nextStep = args.steps.find(s => s.status === "pending" || s.status === "running");
      return [
        `✅ 检查点已保存 [${args.task_id}]`,
        `进度: ${doneCount}/${args.steps.length} 步完成`,
        nextStep ? `下一步: 步骤${nextStep.index + 1} — ${nextStep.text}` : "🎉 全部完成",
        `文件: ${taskFile}`,
      ].join("\n");
    }

    case "task_resume": {
      if (!args.task_id) {
        // 列出所有未完成任务
        if (!fs.existsSync(TASKS_DIR)) return "📭 暂无持久化任务";
        const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith(".json"));
        if (files.length === 0) return "📭 暂无持久化任务";
        const tasks = files.map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")); } catch { return null; }
        }).filter(Boolean);
        const pending = tasks.filter(t => t.status !== "done");
        if (pending.length === 0) return "✅ 所有任务均已完成";
        let out = `📋 未完成任务 (${pending.length} 个):\n\n`;
        pending.forEach(t => {
          const done = t.steps.filter(s => s.status === "done").length;
          const next = t.steps.find(s => s.status !== "done");
          out += `[${t.task_id}] ${t.goal}\n  进度: ${done}/${t.steps.length} | 下一步: ${next?.text || "?"}\n  更新: ${t.updatedAt?.slice(0, 16)}\n\n`;
        });
        out += `→ 用 task_resume(task_id="...") 恢复指定任务`;
        return out;
      }

      const taskFile = path.join(TASKS_DIR, `${args.task_id}.json`);
      if (!fs.existsSync(taskFile)) return `❌ 未找到任务: ${args.task_id}\n可用任务: ${fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR).map(f => f.replace(".json","")).join(", ") : "无"}`;

      const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));

      // 同步恢复到内存锚点
      sessionState.anchor = {
        task_id: task.task_id,
        goal: task.goal,
        steps: task.steps.map(s => ({ index: s.index, text: s.text, done: s.status === "done" })),
        createdAt: task.createdAt,
      };

      const doneSteps = task.steps.filter(s => s.status === "done");
      const pendingSteps = task.steps.filter(s => s.status !== "done");
      const nextStep = pendingSteps[0];

      let out = `🔄 任务已恢复 [${task.task_id}]\n`;
      out += `目标: ${task.goal}\n`;
      out += `Workspace: ${task.workspace}\n`;
      out += `进度: ${doneSteps.length}/${task.steps.length} 步完成\n\n`;

      if (doneSteps.length > 0) {
        out += `✅ 已完成步骤:\n`;
        doneSteps.forEach(s => {
          out += `  ${s.index + 1}. ${s.text}`;
          if (s.result) out += ` → ${s.result.slice(0, 80)}`;
          out += "\n";
        });
        out += "\n";
      }

      if (nextStep) {
        out += `▶️  下一步执行: 步骤${nextStep.index + 1} — ${nextStep.text}\n`;
      } else {
        out += `🎉 所有步骤已完成！\n`;
      }

      if (task.context && Object.keys(task.context).length > 0) {
        out += `\n📦 保存的上下文:\n`;
        Object.entries(task.context).forEach(([k, v]) => {
          out += `  ${k}: ${JSON.stringify(v).slice(0, 100)}\n`;
        });
      }

      // 检查是否存在关联的 Task_Plan，附加下一个待执行原子任务
      try {
        if (fs.existsSync(TASKS_DIR)) {
          const planFile = path.join(TASKS_DIR, `plan_${args.task_id}.json`);
          const planPath = fs.existsSync(planFile) ? planFile : (() => {
            // 模糊匹配：查找 plan_id 包含 task_id 的计划
            const match = fs.readdirSync(TASKS_DIR)
              .filter(f => f.startsWith("plan_") && f.endsWith(".json"))
              .find(f => f.includes(args.task_id));
            return match ? path.join(TASKS_DIR, match) : null;
          })();
          if (planPath && fs.existsSync(planPath)) {
            const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
            const nextAtomicStep = plan.steps.find(s => s.status === "pending" || s.status === "failed");
            if (nextAtomicStep && plan.status !== "completed") {
              out += `\n⚛️  关联原子任务计划 [${plan.plan_id}]:\n`;
              out += `  下一步: ${nextAtomicStep.id} — ${nextAtomicStep.title}\n`;
              out += `  描述: ${nextAtomicStep.description}\n`;
              out += `  → 调用 task_step_start(plan_id="${plan.plan_id}") 开始执行\n`;
            }
          }
        }
      } catch {}

      return out;
    }

    case "task_list": {
      if (!fs.existsSync(TASKS_DIR)) return "📭 暂无持久化任务";
      const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith(".json"));
      if (files.length === 0) return "📭 暂无持久化任务";
      const statusFilter = args.status || "pending";
      const tasks = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")); } catch { return null; }
      }).filter(Boolean);
      const filtered = statusFilter === "all" ? tasks : tasks.filter(t =>
        statusFilter === "done" ? t.status === "done" : t.status !== "done"
      );
      if (filtered.length === 0) return `无 ${statusFilter} 状态的任务`;
      let out = `📋 任务列表 [${statusFilter}] (${filtered.length} 个):\n\n`;
      filtered.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).forEach(t => {
        const done = t.steps.filter(s => s.status === "done").length;
        const icon = t.status === "done" ? "✅" : "🔄";
        out += `${icon} [${t.task_id}]\n   目标: ${t.goal}\n   进度: ${done}/${t.steps.length} | 更新: ${t.updatedAt?.slice(0, 16)}\n\n`;
      });
      return out;
    }

    // ── 首次 Prompt 瘦身 ─────────────────────────────────────────────────────
    case "context_load": {
      const ws = getWorkspace();
      const results = [];
      for (const filename of args.files) {
        const fp = path.isAbsolute(filename) ? filename : path.join(ws, filename);
        if (!fs.existsSync(fp)) {
          results.push(`❌ 未找到: ${filename}`);
          continue;
        }
        let content = fs.readFileSync(fp, "utf8");
        if (args.max_chars && content.length > args.max_chars) {
          content = content.slice(0, args.max_chars) + `\n...[已截断，原文 ${content.length} 字符]`;
        }
        results.push(`=== ${filename} (${content.length} chars) ===\n${content}`);
      }
      return results.join("\n\n");
    }

    case "context_summary": {
      const ws = getWorkspace();
      const maxChars = args.max_tokens_hint || 800;
      const parts = [];

      // 1. 基本 workspace 信息
      parts.push(`📍 Workspace: ${ws}`);

      // 2. 未完成任务（最重要）
      if (args.include_tasks !== false) {
        try {
          if (fs.existsSync(TASKS_DIR)) {
            const pending = fs.readdirSync(TASKS_DIR)
              .filter(f => f.endsWith(".json"))
              .map(f => { try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")); } catch { return null; } })
              .filter(t => t && t.status !== "done");
            if (pending.length > 0) {
              parts.push(`\n🔄 未完成任务 (${pending.length} 个):`);
              pending.slice(0, 3).forEach(t => {
                const done = t.steps.filter(s => s.status === "done").length;
                const next = t.steps.find(s => s.status !== "done");
                parts.push(`  [${t.task_id}] ${t.goal} (${done}/${t.steps.length}) → 下一步: ${next?.text || "?"}`);
              });
            }
          }
        } catch {}
      }

      // 3. workspace 工作日志最近一条
      try {
        const log = loadWorkspaceLog(ws);
        if (log.sessions?.length > 0) {
          const last = log.sessions[log.sessions.length - 1];
          parts.push(`\n📝 上次工作 [${last.date}]: ${last.summary?.slice(0, 120)}`);
          const openNotes = (log.notes || []).filter(n => !n.done).slice(0, 3);
          if (openNotes.length > 0) {
            parts.push(`  待办: ${openNotes.map(n => n.text.slice(0, 60)).join(" | ")}`);
          }
        }
      } catch {}

      // 4. 项目知识库摘要（只列 key）
      if (args.include_knowledge !== false) {
        try {
          const kbFile = path.join(ws, ".lmstudio-knowledge.json");
          if (fs.existsSync(kbFile)) {
            const kb = JSON.parse(fs.readFileSync(kbFile, "utf8"));
            const keys = Object.keys(kb);
            if (keys.length > 0) {
              parts.push(`\n📚 项目知识库 (${keys.length} 条): ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "..." : ""}`);
            }
          }
        } catch {}
      }

      // 5. PROGRESS.md 精简版（只取状态概览和待处理任务）
      try {
        const progressFile = path.join(ws, "PROGRESS.md");
        if (fs.existsSync(progressFile)) {
          const content = fs.readFileSync(progressFile, "utf8");
          // 提取统计行
          const statsMatch = content.match(/```[\s\S]*?总任务数.*?```/);
          if (statsMatch) parts.push(`\n📊 进度统计:\n${statsMatch[0].replace(/```/g, "").trim()}`);
          // 提取待处理任务（⏳ 标记）
          const pendingLines = content.split("\n")
            .filter(l => l.includes("⏳"))
            .map(l => l.replace(/\|/g, "").replace(/\s+/g, " ").trim())
            .slice(0, 6);
          if (pendingLines.length > 0) {
            parts.push(`\n⏳ 待处理任务 (前${pendingLines.length}项):\n` + pendingLines.map(l => `  ${l}`).join("\n"));
          }
        }
      } catch {}

      // 6. IDENTITY.md 精简版（只取前几行）
      try {
        const identityFile = path.join(ws, "IDENTITY.md");
        if (fs.existsSync(identityFile)) {
          const lines = fs.readFileSync(identityFile, "utf8").split("\n").filter(l => l.trim()).slice(0, 5);
          parts.push(`\n🤖 身份: ${lines.join(" | ").slice(0, 200)}`);
        }
      } catch {}

      const summary = parts.join("\n");
      return summary.length > maxChars
        ? summary.slice(0, maxChars) + "\n...[已截断]"
        : summary;
    }

    // ── progress_sync：同步 PROGRESS.md 状态到 workspace log ────────────────
    case "progress_sync": {
      const ws = getWorkspace();
      const progressFile = path.join(ws, args.progress_file || "PROGRESS.md");
      if (!fs.existsSync(progressFile)) return `❌ 未找到 ${progressFile}`;

      const content = fs.readFileSync(progressFile, "utf8");
      const lines = content.split("\n");

      // 统计各状态任务数
      const done = lines.filter(l => l.includes("✅")).length;
      const pending = lines.filter(l => l.includes("⏳")).length;
      const running = lines.filter(l => l.includes("🔄")).length;
      const total = done + pending + running;

      // 提取待处理任务列表
      const pendingTasks = lines
        .filter(l => l.includes("⏳"))
        .map(l => {
          const cols = l.split("|").map(c => c.trim()).filter(Boolean);
          return cols.length >= 3 ? `${cols[0]} ${cols[2]}` : l.trim();
        })
        .slice(0, 10);

      // 更新 workspace log
      const log = loadWorkspaceLog(ws);
      const sessionEntry = {
        date: new Date().toISOString().replace("T", " ").slice(0, 19),
        summary: `progress_sync: 已完成 ${done}/${total} (${Math.round(done/total*100)}%)`,
        todos: pendingTasks,
        notes: [`PROGRESS.md 同步时间: ${new Date().toISOString()}`],
      };
      log.sessions = log.sessions || [];
      log.sessions.push(sessionEntry);

      // 更新 notes：清除旧的进度 note，写入新的
      log.notes = (log.notes || []).filter(n => !n.text.startsWith("进度统计:"));
      log.notes.push({
        text: `进度统计: ${done}/${total} 已完成，待处理: ${pendingTasks.slice(0, 3).join(" | ")}`,
        date: sessionEntry.date,
        done: false,
      });
      saveWorkspaceLog(log, ws);

      return `✅ PROGRESS.md 已同步到 workspace log\n总任务: ${total} | 已完成: ${done} | 待处理: ${pending}\n\n待处理任务:\n${pendingTasks.map(t => `  • ${t}`).join("\n")}`;
    }

    // ── session_start：会话启动一键恢复（读 server log + workspace 状态）──
    case "session_start": {
      const ws = (() => { try { return getWorkspace(); } catch { return null; } })();
      let out = `## 🚀 Session 启动状态报告\n\n`;
      out += `**Workspace**: ${ws || "⚠️ 未设置"}\n\n`;

      const wsLog = loadWorkspaceLog(ws);
      const lastWsSession = wsLog.sessions?.slice(-1)[0];

      let lastConvSnippet = null;
      let lastConvName = null;
      let lastConvTime = null;

      try {
        const convDir = path.join(os.homedir(), ".lmstudio", "conversations");
        if (fs.existsSync(convDir)) {
          // 按文件修改时间倒序（最新的在前）
          const convFiles = fs.readdirSync(convDir)
            .filter(f => f.endsWith(".conversation.json"))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(convDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

          // 寻找最近的包含实际输出的对话
          for (const f of convFiles) {
            const conv = JSON.parse(fs.readFileSync(path.join(convDir, f.name), "utf8"));
            const msgs = conv.messages || [];
            
            let foundOutput = "";
            let msgTimestamp = null;
            
            // 从对话末尾往前找，跳过初始化调用
            for (let i = msgs.length - 1; i >= 0; i--) {
              const ver = msgs[i].versions?.[0];
              if (ver && ver.role === "assistant") {
                let isInitCall = false;
                let textContent = "";

                // 解析 steps
                for (const step of (ver.steps || [])) {
                  if (step.type === "contentBlock") {
                    for (const c of (step.content || [])) {
                      if (c.type === "text" && c.text) {
                        textContent += c.text + "\n";
                      }
                      if (c.type === "toolCallRequest" && ["session_start", "load_global_rules", "load_task_rules"].includes(c.name)) {
                        isInitCall = true;
                      }
                    }
                  }
                }

                // 如果这句话只是用来调起初始化的，忽略它，继续往前找
                if (isInitCall) continue;

                // 清洗掉 <think> 标签，看看还有没有实质内容
                const cleanText = stripThinkingBlocks(textContent).trim();
                if (cleanText.length > 5) {
                  foundOutput = cleanText;
                  // 获取消息的真实时间，而不是文件的 mtime
                  msgTimestamp = msgs[i].createdAt || f.mtime;
                  break;
                }
              }
            }

            if (foundOutput) {
              lastConvSnippet = foundOutput.slice(-500); // 提取最后 500 个字符
              lastConvName = conv.name || f.name;
              lastConvTime = msgTimestamp;
              break;
            }
          }
        }
      } catch (e) {
        lastConvSnippet = "提取历史对话失败: " + e.message;
      }

      out += `### 📝 任务进度摘要 (Task Summary)\n`;
      
      if (lastWsSession) {
        out += `**[已归档摘要]** (归档时间: ${lastWsSession.date})\n`;
        out += `> ${lastWsSession.summary}\n`;
        if (lastWsSession.context) out += `> 上下文: ${lastWsSession.context}\n`;
        
        // 关键逻辑：比较上次归档时间与最后一句对话的真实发生时间
        // 如果最后一句对话比归档时间晚了 1 分钟以上，说明归档后又有新动作
        if (lastConvTime && lastWsSession.date) {
           const summaryTime = new Date(lastWsSession.date).getTime();
           if (lastConvTime > summaryTime + 60000) { 
               out += `\n**[未归档的最新线索]** (发生在归档之后的会话 "${lastConvName}"):\n\`\`\`\n${lastConvSnippet}\n\`\`\`\n`;
               out += `*(⚠️ 提示: 检测到上次 summary 之后还有未归档操作，请结合上述线索，自行判断任务的延续性)*\n`;
           }
        }
      } else {
        out += `*暂无手动归档的 summary。*\n`;
        if (lastConvSnippet) {
          out += `\n**[自动提取的上一次对话记录]** (来自会话 "${lastConvName}"):\n\`\`\`\n${lastConvSnippet}\n\`\`\`\n`;
          out += `*(⚠️ 提示: 这是一个新会话，请根据上述历史记录，判断是否有任务延续性)*\n`;
        }
      }
      out += `\n`;

      // ── 动态扫描并提示可用的 Task Rules ────────────────────────────────
      try {
        const rulesDir = path.join(os.homedir(), ".lmstudio", "tasks"); // 根据您的路径名调整为 tasks
        if (fs.existsSync(rulesDir)) {
          const availableTasks = fs.readdirSync(rulesDir)
            .filter(f => f.endsWith(".md"))
            .map(f => f.replace(".md", ""));
            
          if (availableTasks.length > 0) {
            out += `### 📚 可用任务专属规范 (Task Rules)\n`;
            out += `系统检测到以下外挂规范：[ ${availableTasks.join(", ")} ]\n`;
            out += `→ 请根据您当前要执行的任务类型，主动调用 \`load_task_rules(task="...")\` 加载对应规范。\n\n`;
          }
        }
      } catch (e) {}

      // ── PROGRESS 状态读取（如有）──────────────────────────────────────
      if (args.include_progress !== false && ws) {
        try {
          const pf = path.join(ws, "PROGRESS.md");
          if (fs.existsSync(pf)) {
            const content = fs.readFileSync(pf, "utf8");
            const lines = content.split("\n");
            const done = lines.filter(l => l.includes("✅")).length;
            const pending = lines.filter(l => l.includes("⏳")).length;
            const total = done + pending + lines.filter(l => l.includes("🔄")).length;
            const nextTasks = lines.filter(l => l.includes("⏳")).map(l => l.replace(/\|/g, "").trim()).slice(0, 3);
            
            out += `### 📊 项目进度 (PROGRESS.md)\n`;
            out += `已完成: ${done}/${total} (${Math.round(done/total*100)}%)\n`;
            if (nextTasks.length > 0) out += `下一步待执行:\n${nextTasks.map(t => `  • ${t}`).join("\n")}\n`;
            out += `\n`;
          }
        } catch {}
      }

      return out;
    }

    // ── session_summarize：会话超出 context 前主动压缩状态 ──────────────────
    case "session_summarize": {
      const ws = getWorkspace();
      if (!ws) return "❌ 需要先设置 workspace 才能保存会话摘要";
      
      const log = loadWorkspaceLog(ws);
      log.sessions = log.sessions || [];
      
      const sessionEntry = {
        date: new Date().toISOString(),
        summary: args.next_task,
        context: args.next_task_context || "",
        blockers: args.blockers || [],
        completed: args.completed || []
      };
      
      log.sessions.push(sessionEntry);
      
      // 同步更新顶层的待办 notes
      log.notes = (log.notes || []).filter(n => !n.text.startsWith("[next_task]"));
      log.notes.push({
        text: `[next_task] ${args.next_task}`,
        date: sessionEntry.date,
        done: false,
      });

      saveWorkspaceLog(log, ws);
      
      return `✅ 会话状态已成功更新并归档。\n最新任务摘要: ${args.next_task}\n下次开启新会话时，session_start 将自动对齐并加载此进度。`;
    }

    // ── P1: code_diagnostics ────────────────────────────────────────────────
    case "code_diagnostics": {
      const resolvedPaths = args.paths.map(p => resolvePath(p));
      const tool = args.tool || "auto";
      const results = [];

      // 按扩展名分组
      const byExt = {};
      for (const fp of resolvedPaths) {
        const ext = path.extname(fp).toLowerCase();
        (byExt[ext] = byExt[ext] || []).push(fp);
      }

      const runDiag = async (cmd, label) => {
        try {
          const { stdout, stderr } = await runCmd(cmd, getWorkspace(), 30000);
          return { label, output: (stdout + stderr).trim() };
        } catch (e) {
          // 很多 linter 在有错误时返回非零退出码，需要捕获 stderr
          return { label, output: e.stderr ? (e.stdout + e.stderr).trim() : e.message };
        }
      };

      for (const [ext, fps] of Object.entries(byExt)) {
        const fileList = fps.map(f => `"${f}"`).join(" ");
        const useTool = tool !== "auto" ? tool
          : [".py"].includes(ext) ? "ruff"
          : [".ts", ".tsx"].includes(ext) ? "tsc"
          : [".js", ".jsx", ".mjs"].includes(ext) ? "eslint"
          : null;

        if (!useTool) {
          results.push({ label: ext, output: `无可用诊断工具（扩展名: ${ext}）` });
          continue;
        }

        if (useTool === "ruff") {
          results.push(await runDiag(`python3 -m ruff check --output-format=concise ${fileList} 2>&1 || true`, "ruff"));
          if (tool === "mypy" || (tool === "auto" && fps.some(f => f.endsWith(".py")))) {
            results.push(await runDiag(`python3 -m mypy --no-error-summary ${fileList} 2>&1 || true`, "mypy"));
          }
        } else if (useTool === "eslint") {
          results.push(await runDiag(`eslint --format compact ${fileList} 2>&1 || true`, "eslint"));
        } else if (useTool === "tsc") {
          // tsc 需要 tsconfig，找最近的
          const tsconfig = fps.map(f => {
            let d = path.dirname(f);
            while (d !== path.dirname(d)) {
              if (fs.existsSync(path.join(d, "tsconfig.json"))) return path.join(d, "tsconfig.json");
              d = path.dirname(d);
            }
            return null;
          }).find(Boolean);
          const tscCmd = tsconfig
            ? `tsc --noEmit -p "${tsconfig}" 2>&1 || true`
            : `tsc --noEmit --allowJs --checkJs ${fileList} 2>&1 || true`;
          results.push(await runDiag(tscCmd, "tsc"));
        } else if (useTool === "pylint") {
          results.push(await runDiag(`python3 -m pylint --output-format=text ${fileList} 2>&1 || true`, "pylint"));
        } else if (useTool === "mypy") {
          results.push(await runDiag(`python3 -m mypy --no-error-summary ${fileList} 2>&1 || true`, "mypy"));
        }
      }

      if (results.length === 0) return "✅ 无诊断结果（文件列表为空或无匹配工具）";
      return results.map(r => `[${r.label}]\n${r.output || "✅ 无问题"}`).join("\n\n");
    }

    // ── P1: rg_search ────────────────────────────────────────────────────────
    case "rg_search": {
      const searchDir = args.subpath
        ? path.join(getWorkspace(), args.subpath)
        : getWorkspace();
      const max = args.max_results || 50;
      const ctx = args.context_lines != null ? `-C ${args.context_lines}` : "-C 2";
      const ci = args.case_sensitive ? "" : "-i";
      const fs_flag = args.fixed_strings ? "-F" : "";
      const inc = args.include ? `--glob "${args.include}"` : "";
      const exc = args.exclude ? `--glob "!${args.exclude}"` : "";
      const q = args.query.replace(/'/g, `'\\''`);

      const cmd = `rg ${ci} ${fs_flag} ${ctx} ${inc} ${exc} --line-number --with-filename --max-count ${max} -e '${q}' . 2>/dev/null | head -500`;
      const { stdout } = await runCmd(cmd, searchDir);
      if (!stdout.trim()) return `未找到匹配: ${args.query}`;
      const lines = stdout.trim().split("\n");
      return `🔍 rg "${args.query}" — ${lines.length} 行结果 (最多 ${max} 个匹配)\n\n${stdout.trim()}`;
    }

    // ── P1: lm_chat ──────────────────────────────────────────────────────────
    // thinking 模式：streaming 流式接收，thinking 块实时写入本地文件，
    // 最终只返回 thinking 之后的纯输出，避免内容三重重复。
    // 后续工具可用 lm_thinking_read 读取 thinking 内容作为上下文。
    case "lm_chat": {
      const baseUrl = args.base_url || "http://127.0.0.1:12340";
      const apiKey = "sk-lm-Dfv74CFs:xrtdq4hH3HUizW1R70z0"; // from openclaw.json
      const model = args.model || null;
      const enableThinking = args.enable_thinking ?? true; // 默认保留thinking，但分离存储

      const messages = [];
      if (args.system) messages.push({ role: "system", content: args.system });
      messages.push({ role: "user", content: args.prompt });

      // thinking 日志路径（按会话 ID 区分，方便后续读取）
      const thinkingDir = path.join(os.homedir(), ".lmstudio", ".thinking");
      fs.mkdirSync(thinkingDir, { recursive: true });
      const thinkingId = args.thinking_id || `t-${Date.now()}`;
      const thinkingFile = path.join(thinkingDir, `${thinkingId}.json`);

      const body = JSON.stringify({
        model: model || "local-model",
        messages,
        max_tokens: args.max_tokens || 4096,
        temperature: args.temperature ?? 0.3,
        frequency_penalty: args.frequency_penalty ?? 0.5,
        presence_penalty: args.presence_penalty ?? 0.3,
        stop: args.stop || ["<|end|>", "<|endoftext|>", "\n\n\n\n"],
        stream: true,  // 流式：thinking 实时落盘，不阻塞
        chat_template_kwargs: { enable_thinking: enableThinking },
      });

      const result = await new Promise((resolve, reject) => {
        const url = new URL(`${baseUrl}/v1/chat/completions`);
        const lib = url.protocol === "https:" ? https : http;
        const req = lib.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(body),
          },
        }, (res) => {
          let buffer = "";
          let fullContent = "";  // 累积完整原始内容，end 时统一解析
          let promptTokens = 0, completionTokens = 0;
          let tokenCount = 0;

          // ── 每收到 ~20 个 token 发一次 progress notification，重置 MCP 超时 ──
          const progressToken = extra?._meta?.progressToken;
          let lastProgressAt = Date.now();
          const sendProgress = () => {
            if (!progressToken || !extra?.sendNotification) return;
            const now = Date.now();
            if (now - lastProgressAt < 3000) return; // 最多每3秒一次
            lastProgressAt = now;
            extra.sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: tokenCount, total: args.max_tokens || 512 },
            }).catch(() => {});
          };

          res.on("data", chunk => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (raw === "[DONE]") continue;
              let delta;
              try { delta = JSON.parse(raw).choices?.[0]?.delta?.content || ""; } catch { continue; }
              if (delta) { fullContent += delta; tokenCount++; sendProgress(); }
            }
          });

          res.on("end", () => {
            // 处理 buffer 剩余（usage chunk）
            if (buffer.trim() && buffer.startsWith("data: ")) {
              try {
                const raw = buffer.slice(6).trim();
                if (raw !== "[DONE]") {
                  const usage = JSON.parse(raw).usage;
                  if (usage) { promptTokens = usage.prompt_tokens; completionTokens = usage.completion_tokens; }
                }
              } catch {}
            }

            // 统一解析：提取所有 thinking 块（支持多块、空块）
            const cleanThinking = extractThinkingBlocks(fullContent);
            // output = 去掉所有 thinking 块 + turn token 后的剩余
            const cleanOutput = stripThinkingBlocks(fullContent);

            // 持久化 thinking 到本地
            let thinkingSaved = false;
            if (cleanThinking) {
              const thinkingPayload = JSON.stringify({
                id: thinkingId,
                prompt: args.prompt.slice(0, 200),
                thinking: cleanThinking,
                output: cleanOutput,
                model: model || "local-model",
                createdAt: new Date().toISOString(),
                tokens: { prompt: promptTokens, completion: completionTokens },
              }, null, 2);

              // 尝试主路径
              try {
                fs.writeFileSync(thinkingFile, thinkingPayload, "utf8");
                thinkingSaved = true;
              } catch (e1) {
                console.error(`[lm_chat] thinking 主路径写入失败: ${e1.message} → ${thinkingFile}`);
                // fallback 1：写到 /tmp
                try {
                  const tmpFile = path.join(os.tmpdir(), `lmstudio-thinking-${thinkingId}.json`);
                  fs.writeFileSync(tmpFile, thinkingPayload, "utf8");
                  thinkingSaved = true;
                  console.error(`[lm_chat] thinking 已写入备用路径: ${tmpFile}`);
                } catch (e2) {
                  console.error(`[lm_chat] thinking 备用路径也失败: ${e2.message}`);
                  // fallback 2：thinking 内容直接附在返回值末尾，不丢失
                }
              }
            }

            const usageLine = (promptTokens || completionTokens)
              ? `\n\n[tokens: prompt=${promptTokens} completion=${completionTokens} | thinking_id=${thinkingId}]`
              : `\n\n[thinking_id=${thinkingId}]`;

            // 写入失败时把 thinking 内容附在返回值里，确保不丢失
            const thinkingFallback = (cleanThinking && !thinkingSaved)
              ? `\n\n[thinking_unsaved]\n${cleanThinking}\n[/thinking_unsaved]`
              : "";

            resolve((cleanOutput || fullContent) + usageLine + thinkingFallback);
          });
        });
        req.on("error", reject);
        // HTTP 超时：按 max_tokens 动态计算（每 token ~330ms，加 60s 缓冲）
        const httpTimeoutMs = Math.max(120000, (args.max_tokens || 512) * 400 + 60000);
        req.setTimeout(httpTimeoutMs, () => { req.destroy(new Error(`请求超时（${httpTimeoutMs/1000}s）`)); });
        req.write(body);
        req.end();
      });
      return result;
    }

    // ── lm_thinking_read：读取本地 thinking 记录，供后续操作工具使用 ─────────
    case "lm_thinking_read": {
      const thinkingDir = path.join(os.homedir(), ".lmstudio", ".thinking");
      if (args.thinking_id) {
        // 按优先级查找：主路径 → /tmp 备用路径
        const candidates = [
          path.join(thinkingDir, `${args.thinking_id}.json`),
          path.join(os.tmpdir(), `lmstudio-thinking-${args.thinking_id}.json`),
        ];
        const f = candidates.find(p => fs.existsSync(p));
        if (!f) return `❌ 未找到 thinking 记录: ${args.thinking_id}\n（已查找: ${candidates.join(", ")}）`;
        const rec = JSON.parse(fs.readFileSync(f, "utf8"));
        const section = args.section || "thinking";
        if (section === "output") return rec.output || "（无 output）";
        if (section === "all") return `[thinking]\n${rec.thinking}\n\n[output]\n${rec.output}`;
        return rec.thinking || "（无 thinking 内容）";
      }
      // 列出最近记录（主路径 + /tmp 合并）
      const allFiles = [];
      if (fs.existsSync(thinkingDir)) {
        fs.readdirSync(thinkingDir).filter(f => f.endsWith(".json"))
          .forEach(f => allFiles.push({ path: path.join(thinkingDir, f), src: "main" }));
      }
      // /tmp 里的备用记录
      fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("lmstudio-thinking-") && f.endsWith(".json"))
        .forEach(f => allFiles.push({ path: path.join(os.tmpdir(), f), src: "tmp" }));

      if (allFiles.length === 0) return "📭 暂无 thinking 记录";
      allFiles.sort((a, b) => b.path.localeCompare(a.path));
      const recent = allFiles.slice(0, args.limit || 10);
      let out = `📋 最近 thinking 记录 (${recent.length} 条):\n\n`;
      for (const { path: fp, src } of recent) {
        try {
          const rec = JSON.parse(fs.readFileSync(fp, "utf8"));
          const flag = src === "tmp" ? " ⚠️ [备用/tmp]" : "";
          out += `[${rec.id}]${flag} ${rec.createdAt?.slice(0,16)} | ${rec.model}\n`;
          out += `  prompt: ${rec.prompt?.slice(0,80)}...\n`;
          out += `  thinking: ${rec.thinking?.length || 0} chars | output: ${rec.output?.length || 0} chars\n\n`;
        } catch {}
      }
      return out;
    }

    // ── session_recover：从 conversation 文件恢复 thinking 内容 ──────────────
    // conversation 文件是 LM Studio 的完整对话记录，即使 thinking 写入失败也能从这里恢复
    case "session_recover": {
      const convDir = path.join(os.homedir(), ".lmstudio", "conversations");
      if (!fs.existsSync(convDir)) return "❌ 未找到 conversations 目录";

      // 列出所有 conversation 文件，按修改时间排序
      const files = fs.readdirSync(convDir)
        .filter(f => f.endsWith(".conversation.json"))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(convDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) return "📭 暂无 conversation 记录";

      // 只列出列表
      if (args.action === "list" || !args.action) {
        let out = `📋 最近 conversation 记录 (${Math.min(files.length, args.limit || 10)} 条):\n\n`;
        for (const { name } of files.slice(0, args.limit || 10)) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(convDir, name), "utf8"));
            const msgCount = (d.messages || []).length;
            const convName = d.name || name.replace(".conversation.json", "");
            const model = d.lastUsedModel || "unknown";
            out += `[${name.replace(".conversation.json","")}] "${convName}"\n`;
            out += `  消息数: ${msgCount} | 模型: ${model}\n\n`;
          } catch {}
        }
        out += `→ 用 session_recover(action="extract", conv_id="...") 提取 thinking 内容`;
        return out;
      }

      // 提取指定 conversation 的 thinking 内容
      if (args.action === "extract") {
        const convId = args.conv_id;
        // 支持精确 ID 或模糊匹配名称
        let targetFile = files.find(f => f.name.startsWith(convId || ""))?.name;
        if (!targetFile && convId) {
          // 按名称模糊匹配
          for (const { name } of files) {
            try {
              const d = JSON.parse(fs.readFileSync(path.join(convDir, name), "utf8"));
              if ((d.name || "").includes(convId)) { targetFile = name; break; }
            } catch {}
          }
        }
        if (!targetFile) targetFile = files[0]?.name; // 默认最新

        const d = JSON.parse(fs.readFileSync(path.join(convDir, targetFile), "utf8"));
        const convName = d.name || targetFile;
        const msgs = d.messages || [];

        // 提取所有 thinking 块
        const thinkingBlocks = [];
        const outputBlocks = [];
        let msgIdx = 0;

        for (const msg of msgs) {
          for (const ver of (msg.versions || [])) {
            if (ver.role !== "assistant") continue;
            for (const step of (ver.steps || [])) {
              for (const c of (step.content || [])) {
                const text = c.text || "";
                const thinking = extractThinkingBlocks(text);
                const output = stripThinkingBlocks(text);
                if (thinking) thinkingBlocks.push({ idx: msgIdx, thinking });
                if (output.trim()) outputBlocks.push({ idx: msgIdx, output: output.trim() });
              }
            }
          }
          msgIdx++;
        }

        if (thinkingBlocks.length === 0) return `"${convName}" 中未找到 thinking 内容`;

        // 按需过滤：只取最近 N 条，或指定消息索引
        const limit = args.last_n || thinkingBlocks.length;
        const recent = thinkingBlocks.slice(-limit);

        // 可选：写入 thinking 文件供 lm_thinking_read 使用
        if (args.save) {
          const thinkingDir = path.join(os.homedir(), ".lmstudio", ".thinking");
          fs.mkdirSync(thinkingDir, { recursive: true });
          for (const { idx, thinking } of recent) {
            const recoverId = `recovered-${targetFile.replace(".conversation.json","")}-msg${idx}`;
            const recoverFile = path.join(thinkingDir, `${recoverId}.json`);
            fs.writeFileSync(recoverFile, JSON.stringify({
              id: recoverId,
              source: "session_recover",
              convName,
              thinking,
              output: outputBlocks.find(o => o.idx === idx)?.output || "",
              createdAt: new Date().toISOString(),
            }, null, 2), "utf8");
          }
          return `✅ 已从 "${convName}" 恢复 ${recent.length} 条 thinking 记录到 ~/.lmstudio/.thinking/`;
        }

        // 直接返回内容
        let out = `🔍 从 "${convName}" 提取的 thinking 内容 (最近 ${recent.length} 条):\n\n`;
        for (const { idx, thinking } of recent) {
          out += `[消息 ${idx}]\n${thinking.slice(0, args.max_chars || 500)}`;
          if (thinking.length > (args.max_chars || 500)) out += "\n...[已截断]";
          out += "\n\n---\n\n";
        }
        return out;
      }

      return `未知 action: ${args.action}，支持 list / extract`;
    }

    // ── session_continue：从 conversation 日志分析中断状态，提炼待执行内容 ──
    case "session_continue": {
      const convDir = path.join(os.homedir(), ".lmstudio", "conversations");
      if (!fs.existsSync(convDir)) return "❌ 未找到 conversations 目录";

      // 找目标 conversation（默认最新）
      const files = fs.readdirSync(convDir)
        .filter(f => f.endsWith(".conversation.json"))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(convDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length === 0) return "📭 暂无 conversation 记录";

      let targetFile = files[0].name;
      if (args.conv_id) {
        const match = files.find(f => f.name.startsWith(args.conv_id));
        if (match) targetFile = match.name;
      }

      const d = JSON.parse(fs.readFileSync(path.join(convDir, targetFile), "utf8"));
      const convName = d.name || targetFile;
      const msgs = d.messages || [];

      // ── 解析所有消息，提取关键信息 ──────────────────────────────────────
      const thinkRe = /<\|channel>thought([\s\S]*?)<channel\|>/g;
      const thinkRe2 = /<think>([\s\S]*?)<\/think>/g;

      function extractThinks(text) {
        const blocks = [];
        let m;
        const r1 = new RegExp(thinkRe.source, 'g');
        const r2 = new RegExp(thinkRe2.source, 'g');
        while ((m = r1.exec(text)) !== null) { const t = m[1].trim(); if (t) blocks.push(t); }
        while ((m = r2.exec(text)) !== null) { const t = m[1].trim(); if (t) blocks.push(t); }
        return blocks;
      }
      function cleanOutput(text) {
        return text
          .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/<\|turn>\w+/g, '')
          .replace(/<\|channel>\w+/g, '')
          .trim();
      }

      const analysis = {
        convName,
        totalMsgs: msgs.length,
        lastUserMsg: "",
        lastThinking: [],       // 最后一条 assistant 的 thinking
        lastOutput: "",         // 最后一条 assistant 的 output
        failedTools: [],        // 失败的工具调用
        succeededTools: [],     // 成功的工具调用（最近5个）
        pendingContent: [],     // thinking 里提到"需要写入/执行"但未完成的内容
        workspace: null,
      };

      // 扫描所有消息
      const scanLimit = args.scan_msgs || 20; // 只扫最近N条
      const recentMsgs = msgs.slice(-scanLimit);

      for (const msg of recentMsgs) {
        for (const ver of (msg.versions || [])) {
          const role = ver.role;

          if (role === 'user') {
            for (const c of (ver.content || [])) {
              if (c.type === 'text' && c.text?.trim()) {
                analysis.lastUserMsg = c.text.trim();
              }
            }
          }

          if (role === 'assistant') {
            const msgThinks = [];
            const msgOutputParts = [];
            const msgFailed = [];
            const msgSucceeded = [];

            for (const step of (ver.steps || [])) {
              const stype = step.type;

              if (stype === 'contentBlock') {
                for (const c of (step.content || [])) {
                  const text = c.text || '';
                  const thinks = extractThinks(text);
                  msgThinks.push(...thinks);
                  const out = cleanOutput(text);
                  if (out) msgOutputParts.push(out);
                }
              }

              if (stype === 'toolStatus') {
                const ss = step.statusState || {};
                const status = ss.status || {};
                const st = status.type || '';
                const callId = step.callId;

                if (st === 'toolCallSucceeded') {
                  msgSucceeded.push(callId);
                } else if (st.includes('Failed') || st.includes('failed')) {
                  const err = status.error || '';
                  const raw = status.rawContent || '';
                  msgFailed.push({ callId, error: err, rawContent: raw });
                }
              }
            }

            if (msgThinks.length || msgOutputParts.length || msgFailed.length) {
              analysis.lastThinking = msgThinks;
              analysis.lastOutput = msgOutputParts.join('\n').trim();
              analysis.failedTools = msgFailed;
              analysis.succeededTools = msgSucceeded.slice(-5);
            }
          }
        }
      }

      // ── 从 thinking 里提取"待执行"内容 ──────────────────────────────────
      // 关键词：需要写入、I need to write、file_write、create、implement
      const pendingKeywords = [
        /I need to (?:write|create|implement|fix|update|run|execute)(.*?)(?:\.|$)/gi,
        /需要(?:写入|创建|实现|修复|更新|执行)(.*?)(?:。|$)/g,
        /Let me (?:write|create|implement|fix)(.*?)(?:\.|$)/gi,
        /下一步[：:](.*?)(?:。|$)/g,
        /Next[：:](.*?)(?:\.|$)/gi,
      ];

      for (const think of analysis.lastThinking) {
        for (const re of pendingKeywords) {
          let m;
          const r = new RegExp(re.source, re.flags);
          while ((m = r.exec(think)) !== null) {
            const item = m[0].trim().slice(0, 200);
            if (item && !analysis.pendingContent.includes(item)) {
              analysis.pendingContent.push(item);
            }
          }
        }
      }

      // ── 从 thinking 里提取 workspace 路径 ────────────────────────────────
      const wsRe = /(?:workspace|directory|path)[^\n]*?([\/~][^\s,，。\n]+)/gi;
      for (const think of analysis.lastThinking) {
        let m;
        while ((m = wsRe.exec(think)) !== null) {
          const p = m[1].replace(/^~/, os.homedir());
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            analysis.workspace = p;
            break;
          }
        }
        if (analysis.workspace) break;
      }

      // ── 从失败工具调用里提取可重试的内容 ────────────────────────────────
      const retryable = [];
      for (const ft of analysis.failedTools) {
        // 提取 rawContent 里的文件路径和内容
        const raw = ft.rawContent || '';
        const pathMatch = raw.match(/path[=:]["']?([^\s"',}]+)/);
        const contentMatch = raw.match(/content[=:]["']?([\s\S]{0,500})/);
        if (pathMatch || contentMatch) {
          retryable.push({
            error: ft.error.slice(0, 100),
            path: pathMatch?.[1],
            contentPreview: contentMatch?.[1]?.slice(0, 200),
          });
        }
      }

      // ── 自动恢复 workspace ────────────────────────────────────────────────
      let wsRestored = false;
      if (analysis.workspace && !currentWorkspace) {
        try {
          setWorkspace(analysis.workspace);
          wsRestored = true;
        } catch {}
      }
      if (!wsRestored && !currentWorkspace) {
        try { getWorkspace(); wsRestored = true; } catch {}
      }

      // ── 构建输出报告 ──────────────────────────────────────────────────────
      let report = `## 📋 Session 状态分析: "${convName}"\n\n`;
      report += `消息总数: ${msgs.length} | 扫描最近: ${scanLimit} 条\n`;
      report += `当前 workspace: ${currentWorkspace || '未设置'}\n`;
      if (wsRestored) report += `✅ 已自动恢复 workspace: ${currentWorkspace}\n`;
      report += `\n`;

      report += `### 最后用户指令\n${analysis.lastUserMsg || '（无）'}\n\n`;

      if (analysis.lastThinking.length > 0) {
        report += `### 最后 Thinking 摘要\n`;
        for (const t of analysis.lastThinking.slice(-3)) {
          report += `> ${t.slice(0, 300).replace(/\n/g, '\n> ')}\n\n`;
        }
      }

      if (analysis.failedTools.length > 0) {
        report += `### ❌ 失败的工具调用 (需重试)\n`;
        for (const ft of analysis.failedTools) {
          report += `- 错误: ${ft.error.slice(0, 120)}\n`;
          if (ft.rawContent) report += `  原始内容: ${ft.rawContent.slice(0, 150)}\n`;
        }
        report += `\n`;
      }

      if (retryable.length > 0) {
        report += `### 🔄 可重试操作\n`;
        for (const r of retryable) {
          if (r.path) report += `- 文件路径: ${r.path}\n`;
          if (r.contentPreview) report += `  内容预览: ${r.contentPreview.slice(0, 100)}...\n`;
        }
        report += `\n`;
      }

      if (analysis.pendingContent.length > 0) {
        report += `### 📌 Thinking 中提到的待执行内容\n`;
        for (const p of analysis.pendingContent.slice(0, 5)) {
          report += `- ${p}\n`;
        }
        report += `\n`;
      }

      if (analysis.lastOutput) {
        report += `### 最后输出摘要\n${analysis.lastOutput.slice(0, 400)}\n\n`;
      }

      report += `---\n`;
      report += `**建议下一步**: `;
      if (analysis.failedTools.length > 0) {
        report += `重试上述失败的工具调用，从失败点继续执行。`;
      } else if (analysis.pendingContent.length > 0) {
        report += `执行 Thinking 中提到的待完成操作。`;
      } else {
        report += `根据最后 Thinking 内容继续下一个任务。`;
      }

      return report;
    }

    // ── P2: 后台进程管理 ─────────────────────────────────────────────────────
    case "process_start": {
      const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspace();
      const id = bgPidCounter++;
      const logFile = path.join(os.tmpdir(), `lmstudio-bg-${id}.log`);
      const logStream = fs.createWriteStream(logFile, { flags: "a" });

      const proc = spawn("/bin/bash", ["-c", args.command], {
        cwd,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", d => logStream.write(d));
      proc.stderr.on("data", d => logStream.write(`[stderr] ${d}`));
      proc.on("close", code => {
        logStream.write(`\n[进程退出，code=${code}]\n`);
        logStream.end();
        const entry = bgProcesses.get(id);
        if (entry) entry.exitCode = code;
      });

      bgProcesses.set(id, {
        proc, logFile,
        cmd: args.command,
        label: args.label || args.command.slice(0, 40),
        cwd,
        startedAt: new Date().toISOString(),
        exitCode: null,
      });

      return `✅ 后台进程已启动\nID: ${id}\n命令: ${args.command}\n目录: ${cwd}\n日志: ${logFile}\n\n用 process_output(pid=${id}) 查看输出`;
    }

    case "process_output": {
      const entry = bgProcesses.get(args.pid);
      if (!entry) return `❌ 未找到进程 ID: ${args.pid}`;
      const lines = args.lines || 50;
      try {
        const { stdout } = await runCmd(`tail -n ${lines} "${entry.logFile}"`, "/tmp");
        const status = entry.exitCode !== null ? `已退出 (code=${entry.exitCode})` : "运行中";
        return `📋 进程 ${args.pid} [${entry.label}] — ${status}\n\n${stdout}`;
      } catch {
        return `❌ 无法读取日志: ${entry.logFile}`;
      }
    }

    case "process_kill": {
      const entry = bgProcesses.get(args.pid);
      if (!entry) return `❌ 未找到进程 ID: ${args.pid}`;
      try {
        entry.proc.kill("SIGTERM");
        setTimeout(() => { try { entry.proc.kill("SIGKILL"); } catch {} }, 3000);
        bgProcesses.delete(args.pid);
        return `✅ 已终止进程 ${args.pid} [${entry.label}]`;
      } catch (e) {
        return `❌ 终止失败: ${e.message}`;
      }
    }

    case "process_list_bg": {
      if (bgProcesses.size === 0) return "当前无后台进程";
      let out = `后台进程列表 (${bgProcesses.size} 个):\n\n`;
      for (const [id, entry] of bgProcesses) {
        const status = entry.exitCode !== null ? `已退出(${entry.exitCode})` : "运行中 🟢";
        out += `ID=${id} [${status}] ${entry.label}\n  cwd: ${entry.cwd}\n  启动: ${entry.startedAt}\n`;
      }
      return out;
    }

    // ── P2: symbol_search ────────────────────────────────────────────────────
    case "symbol_search": {
      const sym = args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex
      const lang = args.language || "auto";
      const type = args.type || "all";

      // 按语言构建 rg 模式
      const patterns = {
        python: {
          function: `^\\s*(?:async\\s+)?def\\s+\\w*${sym}\\w*\\s*\\(`,
          class: `^\\s*class\\s+\\w*${sym}\\w*[\\s:(]`,
          method: `^\\s+(?:async\\s+)?def\\s+\\w*${sym}\\w*\\s*\\(`,
        },
        javascript: {
          function: `(?:function\\s+\\w*${sym}\\w*|const\\s+\\w*${sym}\\w*\\s*=\\s*(?:async\\s+)?(?:function|\\())`,
          class: `class\\s+\\w*${sym}\\w*[\\s{]`,
          method: `(?:async\\s+)?\\w*${sym}\\w*\\s*\\([^)]*\\)\\s*\\{`,
        },
        typescript: {
          function: `(?:function\\s+\\w*${sym}\\w*|const\\s+\\w*${sym}\\w*\\s*=|(?:export\\s+)?(?:async\\s+)?function\\s+\\w*${sym}\\w*)`,
          class: `class\\s+\\w*${sym}\\w*[\\s{<]`,
          method: `(?:async\\s+)?\\w*${sym}\\w*\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)`,
        },
      };

      // 文件 glob
      const globs = {
        python: "--glob '*.py'",
        javascript: "--glob '*.{js,jsx,mjs}'",
        typescript: "--glob '*.{ts,tsx}'",
        go: "--glob '*.go'",
        rust: "--glob '*.rs'",
        auto: "",
      };

      const globFlag = globs[lang] || "";
      const langPatterns = patterns[lang] || patterns.javascript;

      let searchPatterns = [];
      if (type === "all" || !langPatterns[type]) {
        // 通用模式：直接搜索符号名
        searchPatterns.push(`\\b${sym}\\b`);
      } else {
        searchPatterns.push(langPatterns[type]);
      }

      const results = [];
      for (const pat of searchPatterns) {
        try {
          const { stdout } = await runCmd(
            `rg -n --with-filename ${globFlag} '${pat.replace(/'/g, "'\\''")}' . 2>/dev/null | head -100`,
            getWorkspace()
          );
          if (stdout.trim()) results.push(stdout.trim());
        } catch {}
      }

      if (results.length === 0) return `未找到符号: ${args.symbol}`;
      return `🔎 符号 "${args.symbol}" 的定义位置:\n\n${results.join("\n")}`;
    }

    // ── P3: file_diff ────────────────────────────────────────────────────────
    case "file_diff": {
      const ctx = args.context_lines ?? 3;
      let fileA = null, fileB = null;
      const tmpDir = os.tmpdir();
      const cleanup = [];

      if (args.text_a != null) {
        fileA = path.join(tmpDir, `lmstudio-diff-a-${Date.now()}.tmp`);
        fs.writeFileSync(fileA, args.text_a, "utf8");
        cleanup.push(fileA);
      } else if (args.path_a) {
        fileA = resolvePath(args.path_a);
      }

      if (args.text_b != null) {
        fileB = path.join(tmpDir, `lmstudio-diff-b-${Date.now()}.tmp`);
        fs.writeFileSync(fileB, args.text_b, "utf8");
        cleanup.push(fileB);
      } else if (args.path_b) {
        fileB = resolvePath(args.path_b);
      }

      if (!fileA || !fileB) throw new Error("需要提供 path_a/text_a 和 path_b/text_b");

      let diff = "";
      try {
        const { stdout } = await runCmd(`diff -u -U ${ctx} "${fileA}" "${fileB}" || true`, "/tmp");
        diff = stdout;
      } finally {
        cleanup.forEach(f => { try { fs.unlinkSync(f); } catch {} });
      }
      return diff || "✅ 两者完全相同，无差异";
    }

    case "file_apply_patch": {
      const fp = resolvePath(args.path);
      const tmpPatch = path.join(os.tmpdir(), `lmstudio-patch-${Date.now()}.patch`);
      fs.writeFileSync(tmpPatch, args.patch, "utf8");
      try {
        const dryFlag = args.dry_run ? "--dry-run" : "";
        const { stdout, stderr } = await runCmd(
          `patch ${dryFlag} --backup -i "${tmpPatch}" "${fp}" 2>&1 || true`,
          "/tmp"
        );
        return args.dry_run
          ? `🔍 预览（未修改）:\n${stdout}${stderr}`
          : `✅ Patch 已应用: ${fp}\n${stdout}${stderr}`;
      } finally {
        try { fs.unlinkSync(tmpPatch); } catch {}
      }
    }

    // ── P3: project_knowledge ────────────────────────────────────────────────
    case "project_knowledge_set": {
      const ws = getWorkspace();
      const kbFile = path.join(ws, ".lmstudio-knowledge.json");
      let kb = {};
      try { if (fs.existsSync(kbFile)) kb = JSON.parse(fs.readFileSync(kbFile, "utf8")); } catch {}
      kb[args.key] = {
        content: args.content,
        tags: args.tags || [],
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(kbFile, JSON.stringify(kb, null, 2), "utf8");
      return `✅ 知识已保存: ${args.key}\n标签: ${(args.tags || []).join(", ") || "（无）"}\n内容: ${args.content.slice(0, 100)}${args.content.length > 100 ? "..." : ""}`;
    }

    case "project_knowledge_get": {
      const ws = getWorkspace();
      const kbFile = path.join(ws, ".lmstudio-knowledge.json");
      if (!fs.existsSync(kbFile)) return "📭 当前 workspace 暂无项目知识库";
      const kb = JSON.parse(fs.readFileSync(kbFile, "utf8"));

      if (args.key) {
        const entry = kb[args.key];
        if (!entry) return `未找到知识条目: ${args.key}`;
        return `📚 ${args.key} [${entry.updatedAt?.slice(0, 10)}]\n标签: ${entry.tags?.join(", ") || "无"}\n\n${entry.content}`;
      }

      let entries = Object.entries(kb);
      if (args.tag) entries = entries.filter(([, v]) => v.tags?.includes(args.tag));
      if (args.search) entries = entries.filter(([k, v]) =>
        k.includes(args.search) || v.content.includes(args.search)
      );

      if (entries.length === 0) return "未找到匹配的知识条目";
      return `📚 项目知识库 (${entries.length} 条):\n\n` + entries.map(([k, v]) =>
        `【${k}】[${v.tags?.join(",") || ""}] ${v.content.slice(0, 120)}${v.content.length > 120 ? "..." : ""}`
      ).join("\n\n");
    }

    case "project_knowledge_delete": {
      const ws = getWorkspace();
      const kbFile = path.join(ws, ".lmstudio-knowledge.json");
      if (!fs.existsSync(kbFile)) return "知识库不存在";
      const kb = JSON.parse(fs.readFileSync(kbFile, "utf8"));
      if (!kb[args.key]) return `未找到: ${args.key}`;
      delete kb[args.key];
      fs.writeFileSync(kbFile, JSON.stringify(kb, null, 2), "utf8");
      return `✅ 已删除知识条目: ${args.key}`;
    }

    // ── v1.4.0: lm_embed ────────────────────────────────────────────────────
    case "lm_embed": {
      const baseUrl = args.base_url || "http://127.0.0.1:12340";
      const apiKey = "sk-lm-Dfv74CFs:xrtdq4hH3HUizW1R70z0";
      const model = args.model || "text-embedding-nomic-embed-text-v1.5";
      const collection = args.collection || "default";
      const ws = getWorkspace();
      const vectorDbFile = path.join(ws, `.lmstudio-vectors-${collection}.json`);

      // 调用 embedding API
      const embedBatch = async (texts) => {
        const body = JSON.stringify({ model, input: texts });
        return new Promise((resolve, reject) => {
          const url = new URL(`${baseUrl}/v1/embeddings`);
          const lib = url.protocol === "https:" ? https : http;
          const req = lib.request({
            hostname: url.hostname, port: url.port || 80,
            path: url.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "Content-Length": Buffer.byteLength(body) },
          }, (res) => {
            let data = "";
            res.on("data", c => { data += c; });
            res.on("end", () => {
              try {
                const json = JSON.parse(data);
                if (json.error) return reject(new Error(json.error.message));
                resolve(json.data.map(d => d.embedding));
              } catch (e) { reject(new Error(`解析失败: ${data.slice(0, 100)}`)); }
            });
          });
          req.on("error", reject);
          req.setTimeout(60000, () => req.destroy(new Error("超时")));
          req.write(body); req.end();
        });
      };

      // 分批处理（每批最多 32 条）
      const BATCH = 32;
      const allEmbeddings = [];
      for (let i = 0; i < args.texts.length; i += BATCH) {
        const batch = args.texts.slice(i, i + BATCH);
        const vecs = await embedBatch(batch);
        allEmbeddings.push(...vecs);

        // 增加 MCP 进度心跳
        if (extra?._meta?.progressToken && extra?.sendNotification) {
          extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken: extra._meta.progressToken,
              progress: i + batch.length,
              total: args.texts.length
            },
          }).catch(() => {});
        }
      }

      // 加载或创建向量库
      let db = { collection, model, entries: [] };
      try { if (fs.existsSync(vectorDbFile)) db = JSON.parse(fs.readFileSync(vectorDbFile, "utf8")); } catch {}

      // 插入/更新条目
      for (let i = 0; i < args.texts.length; i++) {
        const id = args.ids?.[i] || `${Date.now()}-${i}`;
        const existing = db.entries.findIndex(e => e.id === id);
        const entry = { id, text: args.texts[i], vector: allEmbeddings[i], updatedAt: new Date().toISOString() };
        if (existing >= 0) db.entries[existing] = entry;
        else db.entries.push(entry);
      }
      db.updatedAt = new Date().toISOString();
      fs.writeFileSync(vectorDbFile, JSON.stringify(db), "utf8");

      return `✅ 已向量化 ${args.texts.length} 条文本\n集合: ${collection} (共 ${db.entries.length} 条)\n模型: ${model}\n库文件: ${vectorDbFile}`;
    }

    case "semantic_search": {
      const baseUrl = args.base_url || "http://127.0.0.1:12340";
      const apiKey = "sk-lm-Dfv74CFs:xrtdq4hH3HUizW1R70z0";
      const model = args.model || "text-embedding-nomic-embed-text-v1.5";
      const collection = args.collection || "default";
      const topK = args.top_k || 5;
      const ws = getWorkspace();
      const vectorDbFile = path.join(ws, `.lmstudio-vectors-${collection}.json`);

      if (!fs.existsSync(vectorDbFile)) return `❌ 向量库不存在: ${collection}\n请先用 lm_embed 或 embed_files 建立索引`;
      const db = JSON.parse(fs.readFileSync(vectorDbFile, "utf8"));
      if (!db.entries?.length) return "向量库为空";

      // 获取查询向量
      const body = JSON.stringify({ model, input: [args.query] });
      const queryVec = await new Promise((resolve, reject) => {
        const url = new URL(`${baseUrl}/v1/embeddings`);
        const lib = url.protocol === "https:" ? https : http;
        const req = lib.request({
          hostname: url.hostname, port: url.port || 80,
          path: url.pathname, method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
          let data = "";
          res.on("data", c => { data += c; });
          res.on("end", () => {
            try { resolve(JSON.parse(data).data[0].embedding); }
            catch (e) { reject(new Error(`解析失败: ${data.slice(0, 100)}`)); }
          });
        });
        req.on("error", reject);
        req.setTimeout(30000, () => req.destroy(new Error("超时")));
        req.write(body); req.end();
      });

      // 余弦相似度计算
      const cosineSim = (a, b) => {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
      };

      const scored = db.entries
        .map(e => ({ ...e, score: cosineSim(queryVec, e.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      let out = `🔍 语义搜索: "${args.query}"\n集合: ${collection} (${db.entries.length} 条)\n\n`;
      scored.forEach((e, i) => {
        out += `[${i + 1}] 相似度: ${e.score.toFixed(4)} | ID: ${e.id}\n${e.text.slice(0, 200)}${e.text.length > 200 ? "..." : ""}\n\n`;
      });
      return out;
    }

    case "embed_files": {
      const ws = getWorkspace();
      const include = args.include || "**/*.{py,js,ts,md,txt}";
      const collection = args.collection || path.basename(ws);
      const chunkSize = args.chunk_size || 500;

      // 用 rg 找文件
      const { stdout: fileList } = await runCmd(
        `rg --files --glob '${include}' --glob '!node_modules' --glob '!.git' --glob '!__pycache__' 2>/dev/null | head -200`,
        ws
      );
      const files = fileList.trim().split("\n").filter(Boolean);
      if (files.length === 0) return `未找到匹配文件: ${include}`;

      // 分块
      const chunks = [];
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(ws, file), "utf8");
          for (let i = 0; i < content.length; i += chunkSize) {
            chunks.push({ id: `${file}:${i}`, text: `[${file}]\n${content.slice(i, i + chunkSize)}` });
          }
        } catch {}
      }
      if (chunks.length === 0) return "无可索引内容";

      // 调用 lm_embed 逻辑（复用）
      const embedResult = await handleTool("lm_embed", {
        texts: chunks.map(c => c.text),
        ids: chunks.map(c => c.id),
        collection,
        model: args.model,
        base_url: args.base_url,
      }, extra);
      return `📁 已索引 ${files.length} 个文件，${chunks.length} 个块\n${embedResult}`;
    }

    // ── v1.4.0: lm_review ───────────────────────────────────────────────────
    case "lm_review": {
      let code = args.content || "";
      let lang = args.language || "";
      if (args.path) {
        const fp = resolvePath(args.path);
        code = fs.readFileSync(fp, "utf8");
        lang = lang || path.extname(fp).slice(1);
      }
      if (!code) throw new Error("需要提供 path 或 content");

      const focus = args.focus || "all";
      const focusMap = {
        security: "安全漏洞（注入、越权、敏感信息泄露、不安全的依赖等）",
        performance: "性能问题（复杂度、内存泄漏、不必要的循环、阻塞操作等）",
        readability: "可读性（命名、注释、函数长度、代码重复等）",
        logic: "逻辑错误（边界条件、空值处理、错误处理、竞态条件等）",
        all: "安全、性能、可读性、逻辑错误",
      };

      const system = `你是一个专业代码审查员。请对以下${lang ? ` ${lang}` : ""}代码进行审查，重点关注：${focusMap[focus] || focusMap.all}。
        输出格式：
        1. 总体评分（1-10）
        2. 发现的问题列表（每项包含：严重程度[高/中/低]、位置、描述、建议修复方案）
        3. 优点总结
        请用中文回答，简洁直接。`;

      const truncated = code.length > 8000 ? code.slice(0, 8000) + "\n...[已截断]" : code;
      return await handleTool("lm_chat", {
        system,
        prompt: `\`\`\`${lang}\n${truncated}\n\`\`\``,
        max_tokens: args.max_tokens || 4096,
        temperature: 0.2,
        frequency_penalty: 0.5,
        model: args.model,
        base_url: args.base_url,
      }, extra);
    }

    // ── v1.4.0: git 操作补全 ────────────────────────────────────────────────
    case "git_commit": {
      const ws = getWorkspace();
      const files = args.files || ["."];
      const addCmd = `git add ${files.map(f => `"${f}"`).join(" ")}`;
      await runCmd(addCmd, ws);

      let message = args.message;
      if (!message || args.auto_message) {
        // 获取 diff 生成 commit message
        const { stdout: diff } = await runCmd("git diff --staged --stat", ws).catch(() => ({ stdout: "" }));
        const { stdout: diffDetail } = await runCmd("git diff --staged | head -100", ws).catch(() => ({ stdout: "" }));
        if (diff.trim()) {
          message = await handleTool("lm_chat", {
            system: "你是一个 git commit message 生成器。根据 diff 生成简洁的 conventional commit message（格式: type(scope): description）。只输出 message，不要解释。",
            prompt: `diff stat:\n${diff}\n\ndiff detail:\n${diffDetail}`,
            max_tokens: 100,
            temperature: 0.2,
          }, extra).catch(() => message || "chore: update files");
          message = message.trim().split("\n")[0]; // 只取第一行
        } else {
          message = message || "chore: update files";
        }
      }

      const { stdout } = await runCmd(`git commit -m "${message.replace(/"/g, '\\"')}"`, ws);
      return `✅ 已提交\n${stdout}\n\nCommit message: ${message}`;
    }

    case "git_branch": {
      const ws = getWorkspace();
      switch (args.action) {
        case "list": {
          const { stdout } = await runCmd("git branch -a --color=never", ws);
          return stdout;
        }
        case "current": {
          const { stdout } = await runCmd("git branch --show-current", ws);
          return `当前分支: ${stdout.trim()}`;
        }
        case "create": {
          if (!args.name) throw new Error("需要提供分支名");
          const base = args.base ? `${args.base}` : "";
          const { stdout } = await runCmd(`git checkout -b "${args.name}" ${base}`, ws);
          return `✅ 已创建并切换到分支: ${args.name}\n${stdout}`;
        }
        case "checkout": {
          if (!args.name) throw new Error("需要提供分支名");
          const { stdout } = await runCmd(`git checkout "${args.name}"`, ws);
          return `✅ 已切换到分支: ${args.name}\n${stdout}`;
        }
        case "delete": {
          if (!args.name) throw new Error("需要提供分支名");
          const { stdout } = await runCmd(`git branch -d "${args.name}"`, ws);
          return `✅ 已删除分支: ${args.name}\n${stdout}`;
        }
        default: throw new Error(`未知 action: ${args.action}`);
      }
    }

    case "git_stash": {
      const ws = getWorkspace();
      const idx = args.index ?? 0;
      switch (args.action) {
        case "push": {
          const msg = args.message ? `-m "${args.message}"` : "";
          const { stdout } = await runCmd(`git stash push ${msg}`, ws);
          return `✅ 已暂存\n${stdout}`;
        }
        case "pop": {
          const { stdout } = await runCmd(`git stash pop stash@{${idx}}`, ws);
          return `✅ 已恢复 stash@{${idx}}\n${stdout}`;
        }
        case "list": {
          const { stdout } = await runCmd("git stash list", ws);
          return stdout || "暂无 stash";
        }
        case "drop": {
          const { stdout } = await runCmd(`git stash drop stash@{${idx}}`, ws);
          return `✅ 已删除 stash@{${idx}}\n${stdout}`;
        }
        case "show": {
          const { stdout } = await runCmd(`git stash show -p stash@{${idx}}`, ws);
          return stdout;
        }
        default: throw new Error(`未知 action: ${args.action}`);
      }
    }

    case "git_log": {
      const ws = getWorkspace();
      const limit = args.limit || 20;
      const fmt = args.oneline !== false ? "--oneline" : "--format='%h %ad %an: %s' --date=short";
      const author = args.author ? `--author="${args.author}"` : "";
      const since = args.since ? `--since="${args.since}"` : "";
      const file = args.file ? `-- "${args.file}"` : "";
      const { stdout } = await runCmd(`git log -${limit} ${fmt} ${author} ${since} ${file}`, ws);
      return stdout || "无提交历史";
    }

    // ── v1.4.0: http_request ────────────────────────────────────────────────
    case "http_request": {
      const method = (args.method || "GET").toUpperCase();
      const timeout = (args.timeout_seconds || 30) * 1000;
      let bodyStr = "";
      const extraHeaders = args.headers || {};

      if (args.json) {
        bodyStr = JSON.stringify(args.json);
        extraHeaders["Content-Type"] = "application/json";
      } else if (args.body) {
        bodyStr = args.body;
      }

      const result = await new Promise((resolve, reject) => {
        const url = new URL(args.url);
        const lib = url.protocol === "https:" ? https : http;
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: {
            "User-Agent": "lmstudio-workspace-tools/1.4.0",
            ...extraHeaders,
          },
        };
        if (bodyStr) options.headers["Content-Length"] = Buffer.byteLength(bodyStr);

        const req = lib.request(options, (res) => {
          let data = "";
          res.on("data", c => { data += c; });
          res.on("end", () => {
            const statusLine = `HTTP ${res.statusCode} ${res.statusMessage}`;
            const hdrs = Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
            const body = data.length > 5000 ? data.slice(0, 5000) + "\n...[已截断]" : data;
            // 尝试格式化 JSON
            let formatted = body;
            try { formatted = JSON.stringify(JSON.parse(body), null, 2); } catch {}
            resolve(`${statusLine}\n${hdrs}\n\n${formatted}`);
          });
        });
        req.on("error", reject);
        req.setTimeout(timeout, () => req.destroy(new Error(`请求超时 (${args.timeout_seconds || 30}s)`)));
        if (bodyStr) req.write(bodyStr);
        req.end();
      });
      return result;
    }

    // ── v1.4.0: workspace_snapshot / restore ────────────────────────────────
    case "workspace_snapshot": {
      const ws = getWorkspace();
      const snapshotName = args.name || new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const snapshotDir = path.join(ws, ".lmstudio-snapshots", snapshotName);
      const include = args.include || "**/*.{py,js,ts,jsx,tsx,json,yaml,yml,toml,md,sh,env}";
      const excludes = (args.exclude || "node_modules,__pycache__,.git,.venv,dist,build").split(",");

      const excludeGlobs = excludes.map(e => `--glob '!${e.trim()}'`).join(" ");
      const { stdout: fileList } = await runCmd(
        `rg --files --glob '${include}' ${excludeGlobs} 2>/dev/null | head -500`,
        ws
      );
      const files = fileList.trim().split("\n").filter(Boolean);
      if (files.length === 0) return "未找到可快照的文件";

      fs.mkdirSync(snapshotDir, { recursive: true });
      let copied = 0;
      for (const file of files) {
        try {
          const src = path.join(ws, file);
          const dst = path.join(snapshotDir, file);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          copied++;
        } catch {}
      }

      // 保存元数据
      const meta = { name: snapshotName, note: args.note || "", files: files.length, createdAt: new Date().toISOString(), workspace: ws };
      fs.writeFileSync(path.join(snapshotDir, ".meta.json"), JSON.stringify(meta, null, 2));

      return `✅ 快照已创建: ${snapshotName}\n文件数: ${copied}/${files.length}\n路径: ${snapshotDir}${args.note ? `\n备注: ${args.note}` : ""}`;
    }

    case "workspace_restore": {
      const ws = getWorkspace();
      const snapshotsBase = path.join(ws, ".lmstudio-snapshots");

      if (!args.name) {
        // 列出所有快照
        if (!fs.existsSync(snapshotsBase)) return "📭 暂无快照";
        const snaps = fs.readdirSync(snapshotsBase).filter(d =>
          fs.statSync(path.join(snapshotsBase, d)).isDirectory()
        );
        if (snaps.length === 0) return "📭 暂无快照";
        let out = `📸 可用快照 (${snaps.length} 个):\n\n`;
        snaps.sort().reverse().forEach(s => {
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(snapshotsBase, s, ".meta.json"), "utf8"));
            out += `[${s}] ${meta.files} 个文件 | ${meta.createdAt?.slice(0, 16)}${meta.note ? ` | ${meta.note}` : ""}\n`;
          } catch { out += `[${s}]\n`; }
        });
        return out;
      }

      const snapshotDir = path.join(snapshotsBase, args.name);
      if (!fs.existsSync(snapshotDir)) return `❌ 快照不存在: ${args.name}`;

      // 收集快照中的文件
      const { stdout: snapFiles } = await runCmd("find . -type f ! -name '.meta.json'", snapshotDir);
      const files = snapFiles.trim().split("\n").filter(Boolean).map(f => f.replace(/^\.\//, ""));
      const toRestore = args.files?.length ? files.filter(f => args.files.includes(f)) : files;

      if (args.dry_run) {
        return `🔍 预览恢复 (${toRestore.length} 个文件):\n${toRestore.slice(0, 20).join("\n")}${toRestore.length > 20 ? "\n..." : ""}`;
      }

      let restored = 0;
      for (const file of toRestore) {
        try {
          const src = path.join(snapshotDir, file);
          const dst = path.join(ws, file);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          restored++;
        } catch {}
      }
      return `✅ 已从快照 [${args.name}] 恢复 ${restored} 个文件`;
    }

    // ── v1.4.0: template_render ─────────────────────────────────────────────
    case "template_render": {
      let tmpl = args.template || "";
      if (args.template_file) {
        tmpl = fs.readFileSync(resolvePath(args.template_file), "utf8");
      }
      if (!tmpl) throw new Error("需要提供 template 或 template_file");

      const vars = args.vars || {};

      // 简单 Mustache 风格渲染：{{var}}、{{#if var}}...{{/if}}、{{#each arr}}...{{/each}}
      let result = tmpl;

      // {{#each arr}}...{{/each}}
      result = result.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
        const arr = vars[key];
        if (!Array.isArray(arr)) return "";
        return arr.map(item => {
          let block = body;
          if (typeof item === "object") {
            Object.entries(item).forEach(([k, v]) => {
              block = block.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
            });
          } else {
            block = block.replace(/\{\{this\}\}/g, String(item));
          }
          return block;
        }).join("");
      });

      // {{#if var}}...{{/if}}
      result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
        return vars[key] ? body : "";
      });

      // {{var}} 变量替换
      result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return key in vars ? String(vars[key]) : `{{${key}}}`;
      });

      if (args.output_file) {
        const fp = resolvePath(args.output_file);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, result, "utf8");
        return `✅ 已渲染并写入: ${fp} (${result.length} chars)`;
      }
      return result;
    }

    // ── v1.4.0: file_watch ──────────────────────────────────────────────────
    case "file_watch": {
      const watchPath = resolvePath(args.path);
      if (!fs.existsSync(watchPath)) throw new Error(`路径不存在: ${watchPath}`);
      const duration = Math.min(args.duration_seconds || 10, 60) * 1000;
      const include = args.include;

      // 记录初始状态
      const getState = async (dir) => {
        const state = {};
        try {
          const isDir = fs.statSync(dir).isDirectory();
          if (!isDir) {
            const st = fs.statSync(dir);
            return { [dir]: { mtime: st.mtimeMs, size: st.size } };
          }
          const { stdout } = await runCmd(
            `find "${dir}" -type f 2>/dev/null | head -1000`,
            "/"
          );
          stdout.trim().split("\n").filter(Boolean).forEach(f => {
            try { const st = fs.statSync(f); state[f] = { mtime: st.mtimeMs, size: st.size }; } catch {}
          });
        } catch {}
        return state;
      };

      const before = await getState(watchPath);
      await new Promise(r => setTimeout(r, duration));
      const after = await getState(watchPath);

      const changes = [];
      // 新增/修改
      for (const [f, stat] of Object.entries(after)) {
        if (!before[f]) changes.push(`➕ 新增: ${f}`);
        else if (before[f].mtime !== stat.mtime) changes.push(`✏️  修改: ${f} (${before[f].size}→${stat.size} bytes)`);
      }
      // 删除
      for (const f of Object.keys(before)) {
        if (!after[f]) changes.push(`🗑️  删除: ${f}`);
      }

      if (changes.length === 0) return `✅ 监听 ${duration / 1000}s 内无文件变化: ${watchPath}`;
      return `📡 文件变化 (监听 ${duration / 1000}s):\n\n${changes.join("\n")}`;
    }

    // ── Task Atomizer: task_plan_register ────────────────────────────────────
    case "task_plan_register": {
      const { plan_id, goal, steps } = args;

      // 验证每个 step 含必填字段
      const requiredFields = ["id", "title", "description", "token_budget"];
      const missingFieldErrors = [];
      for (const step of steps) {
        const missing = requiredFields.filter(f => !(f in step) || step[f] === undefined || step[f] === null || step[f] === "");
        if (missing.length > 0) {
          missingFieldErrors.push(`步骤 "${step.id || "(无id)"}" 缺少字段: ${missing.join(", ")}`);
        }
      }
      if (missingFieldErrors.length > 0) {
        return `❌ 步骤字段验证失败:\n${missingFieldErrors.map(e => `  • ${e}`).join("\n")}`;
      }

      // 验证 token_budget 不超过 TOKEN_BUDGET_MAX
      const overBudgetSteps = steps.filter(s => s.token_budget > TOKEN_BUDGET_MAX);
      if (overBudgetSteps.length > 0) {
        const list = overBudgetSteps.map(s =>
          `  • 步骤 "${s.id}" (${s.title}): token_budget=${s.token_budget} > ${TOKEN_BUDGET_MAX}，需进一步分解`
        ).join("\n");
        return `❌ 以下步骤的 token_budget 超过上限 ${TOKEN_BUDGET_MAX}，请进一步分解:\n${list}`;
      }

      // 构造 plan JSON
      const now = new Date().toISOString();
      const plan = {
        plan_id,
        goal,
        status: "active",
        created_at: now,
        updated_at: now,
        workspace: currentWorkspace || process.cwd(),
        steps: steps.map(s => ({
          id: s.id,
          title: s.title,
          description: s.description,
          token_budget: s.token_budget,
          status: "pending",
          started_at: null,
          done_at: null,
          result_summary: null,
        })),
      };

      // 写入磁盘
      fs.mkdirSync(TASKS_DIR, { recursive: true });
      const planFile = path.join(TASKS_DIR, `plan_${plan_id}.json`);
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), "utf8");

      return `✅ 计划 ${plan_id} 已注册，共 ${steps.length} 步。\n请同步调用 context_anchor(set) 设置任务锚点。`;
    }

    // ── Task Atomizer: task_plan_get ──────────────────────────────────────────
    case "task_plan_get": {
      const { plan_id } = args;
      const planFile = path.join(TASKS_DIR, `plan_${plan_id}.json`);
      if (!fs.existsSync(planFile)) {
        return `❌ 未找到计划: ${plan_id}`;
      }
      const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
      return JSON.stringify(plan, null, 2);
    }

    // ── Task Atomizer: task_plan_list ─────────────────────────────────────────
    case "task_plan_list": {
      const statusFilter = args.status || "active";
      if (!fs.existsSync(TASKS_DIR)) return JSON.stringify([]);

      const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith("plan_") && f.endsWith(".json"));
      const plans = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")); } catch { return null; }
      }).filter(Boolean);

      const filtered = statusFilter === "all" ? plans : plans.filter(p => p.status === statusFilter);

      const summaries = filtered.map(p => {
        const done_steps = p.steps.filter(s => s.status === "done" || s.status === "skipped").length;
        return {
          plan_id: p.plan_id,
          goal: p.goal,
          total_steps: p.steps.length,
          done_steps,
          status: p.status,
          created_at: p.created_at,
        };
      });

      return JSON.stringify(summaries, null, 2);
    }

    // ── Task Atomizer: task_step_start ───────────────────────────────────────
    case "task_step_start": {
      const { plan_id, step_id } = args;
      const planFile = path.join(TASKS_DIR, `plan_${plan_id}.json`);
      if (!fs.existsSync(planFile)) {
        return `❌ 计划不存在: ${plan_id}，请先调用 task_plan_register 注册计划`;
      }
      const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
      if (plan.status === "completed") {
        return `✅ 计划 ${plan_id} 已全部完成`;
      }

      // 取指定步骤或第一个 pending/failed 步骤
      let step;
      if (step_id) {
        step = plan.steps.find(s => s.id === step_id);
        if (!step) return `❌ 步骤不存在: ${step_id}`;
      } else {
        step = plan.steps.find(s => s.status === "pending" || s.status === "failed");
        if (!step) return `✅ 计划 ${plan_id} 无待执行步骤`;
      }

      const stepIndex = plan.steps.indexOf(step);
      const total = plan.steps.length;
      const isRetry = step.status === "failed";

      // 更新步骤状态为 running
      step.status = "running";
      step.started_at = new Date().toISOString();
      plan.updated_at = new Date().toISOString();
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), "utf8");

      const result = {
        step_id: step.id,
        title: step.title,
        description: step.description,
        token_budget: step.token_budget,
        progress: `步骤 ${stepIndex + 1}/${total}: ${step.title}`,
        constraint: `⚠️ 仅执行本步骤，token 预算: ${step.token_budget}`,
        ...(isRetry ? { retry: true } : {}),
      };
      return JSON.stringify(result, null, 2);
    }

    // ── Task Atomizer: task_step_done ─────────────────────────────────────────
    case "task_step_done": {
      const { plan_id, step_id, result_summary, status } = args;
      const planFile = path.join(TASKS_DIR, `plan_${plan_id}.json`);
      if (!fs.existsSync(planFile)) {
        return `❌ 计划不存在: ${plan_id}`;
      }
      const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
      const step = plan.steps.find(s => s.id === step_id);
      if (!step) return `❌ 步骤不存在: ${step_id}`;
      if (step.status !== "running") {
        return `❌ 步骤 "${step_id}" 当前状态为 "${step.status}"，不是 running，无法确认完成（防止乱序确认）`;
      }

      // 更新步骤
      const now = new Date().toISOString();
      step.status = status;
      step.done_at = now;
      step.result_summary = result_summary
        ? result_summary.slice(0, 200)
        : null;
      plan.updated_at = now;

      // 检查计划是否全部完成
      const allFinished = plan.steps.every(s => s.status === "done" || s.status === "skipped");
      if (allFinished) plan.status = "completed";

      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), "utf8");

      // 若 status=done，同步写入 task_checkpoint 格式的检查点文件
      if (status === "done") {
        const ckptFile = path.join(TASKS_DIR, `${plan_id}_${step_id}.json`);
        const ckptPayload = {
          task_id: `${plan_id}_${step_id}`,
          goal: step.title,
          steps: [{ index: 0, text: step.description, status: "done", result: step.result_summary }],
          current_step: 0,
          context: { plan_id, step_id },
          workspace: getWorkspace(),
          status: "done",
          createdAt: step.started_at || now,
          updatedAt: now,
        };
        fs.writeFileSync(ckptFile, JSON.stringify(ckptPayload, null, 2), "utf8");
      }

      // 找下一步
      const nextStep = plan.steps.find(s => s.status === "pending" || s.status === "failed");
      const response = {
        step_id,
        status,
        plan_status: plan.status,
        ...(nextStep ? { next_step_id: nextStep.id, next_step_title: nextStep.title } : {}),
        ...(allFinished ? { plan_completed: true } : {}),
      };
      return JSON.stringify(response, null, 2);
    }

    // ── Task Atomizer: task_decompose_check ───────────────────────────────────
    case "task_decompose_check": {
      const { proposed_steps } = args;
      const violations = (proposed_steps || [])
        .map((s, i) => ({ index: i, title: s.title, estimated_tokens: s.estimated_tokens }))
        .filter(s => s.estimated_tokens > TOKEN_BUDGET_DEFAULT)
        .map(s => ({ ...s, limit: TOKEN_BUDGET_DEFAULT }));

      if (violations.length === 0) {
        return JSON.stringify({ needs_decomposition: false, approved: true }, null, 2);
      }
      return JSON.stringify({ needs_decomposition: true, violations }, null, 2);
    }

    // ── v1.5.0: tmux 集成 ────────────────────────────────────────────────────

    case "tmux_run": {
      const session = args.session || "0";
      const timeoutSec = args.timeout_seconds || 30;
      const wait = args.wait !== false;

      let targetPane;
      if (args.pane) {
        targetPane = args.pane;
      } else if (args.new_window && args.window) {
        await runCmd(`tmux new-window -t ${session} -n "${args.window}" -d`, "/tmp").catch(() => {});
        targetPane = `${session}:${args.window}.0`;
      } else {
        targetPane = session;
      }

      if (!wait) {
        const escaped = args.command.replace(/'/g, "'\\''");
        await runCmd(`tmux send-keys -t '${targetPane}' '${escaped}' Enter`, "/tmp");
        return `✅ 命令已发送到 tmux pane [${targetPane}]\n用 tmux_capture(pane="${targetPane}") 读取输出`;
      }

      const sentinel = `__TMUX_DONE_${Date.now()}__`;
      const escaped = args.command.replace(/'/g, "'\\''");
      await runCmd(`tmux send-keys -t '${targetPane}' '${escaped} ; echo ${sentinel}' Enter`, "/tmp");

      const deadline = Date.now() + timeoutSec * 1000;
      let output = "";
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 300));

        // 增加 MCP 进度心跳
        if (extra?._meta?.progressToken && extra?.sendNotification) {
          extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken: extra._meta.progressToken,
              progress: Date.now(),
              total: deadline
            },
          }).catch(() => {});
        }

        try {
          const { stdout } = await runCmd(`tmux capture-pane -pt '${targetPane}' -S -${timeoutSec * 5}`, "/tmp");
          if (stdout.includes(sentinel)) {
            output = stdout
              .split("\n")
              .filter(l => !l.includes(sentinel) && !l.includes(`echo ${sentinel}`))
              .join("\n")
              .trim();
            break;
          }
        } catch {}
      }

      if (!output && Date.now() >= deadline) {
        return `⚠️ 命令超时 (${timeoutSec}s)，用 tmux_capture(pane="${targetPane}") 查看当前输出`;
      }
      return `[tmux:${targetPane}] $ ${args.command}\n${output}`;
    }

    case "tmux_send": {
      const pane = args.pane || "0";
      if (args.keys) {
        await runCmd(`tmux send-keys -t '${pane}' ${args.keys}`, "/tmp");
        return `✅ 已发送按键 [${args.keys}] 到 pane [${pane}]`;
      }
      const text = (args.text || "").replace(/'/g, "'\\''");
      const enter = args.enter !== false ? " Enter" : "";
      await runCmd(`tmux send-keys -t '${pane}' '${text}'${enter}`, "/tmp");
      return `✅ 已发送到 pane [${pane}]: ${args.text}`;
    }

    case "tmux_capture": {
      const pane = args.pane || "0";
      const lines = args.lines || 50;
      const startLine = args.start_line !== undefined ? args.start_line : -lines;
      const { stdout } = await runCmd(
        `tmux capture-pane -pt '${pane}' -S ${startLine} 2>/dev/null || tmux capture-pane -pt '${pane}'`,
        "/tmp"
      );
      return `[tmux pane: ${pane}]\n${stdout}`;
    }

    case "tmux_list": {
      const detail = args.detail !== false;
      const { stdout: sessions } = await runCmd("tmux list-sessions 2>/dev/null || echo '无活跃 tmux session'", "/tmp");
      if (!detail || sessions.includes("无活跃")) return sessions;
      let out = `tmux sessions:\n${sessions}\n`;
      try {
        const { stdout: windows } = await runCmd("tmux list-windows -a 2>/dev/null", "/tmp");
        out += `\nwindows:\n${windows}\n`;
        const { stdout: panes } = await runCmd("tmux list-panes -a 2>/dev/null", "/tmp");
        out += `\npanes:\n${panes}`;
      } catch {}
      return out;
    }

    case "tmux_new_session": {
      const cwd = args.cwd ? resolvePath(args.cwd) : getWorkspace();
      const detach = args.detach !== false ? "-d" : "";
      await runCmd(`tmux new-session -s '${args.name}' ${detach} -c '${cwd}'`, "/tmp");
      return `✅ tmux session '${args.name}' 已创建\n工作目录: ${cwd}`;
    }

    case "tmux_kill": {
      const { target, type } = args;
      let cmd;
      if (type === "session" || (!type && !target.includes(":"))) {
        cmd = `tmux kill-session -t '${target}'`;
      } else if (type === "window" || (!type && target.includes(":") && !target.includes("."))) {
        cmd = `tmux kill-window -t '${target}'`;
      } else {
        cmd = `tmux kill-pane -t '${target}'`;
      }
      await runCmd(cmd, "/tmp");
      return `✅ 已关闭: ${target}`;
    }

    // ── v1.5.0: SSH 会话（tmux 隔离）────────────────────────────────────────
    case "ssh_session": {
      const session = args.session || "0";
      const host = args.host;
      const user = args.user || "root";
      const port = args.port || 22;
      const windowName = args.window_name || `ssh-${host}`;
      const paneTarget = `${session}:${windowName}.0`;

      const sshOpts = [
        "-o StrictHostKeyChecking=no",
        "-o UserKnownHostsFile=/dev/null",
        "-o ServerAliveInterval=30",
        "-o ServerAliveCountMax=3",
        `-p ${port}`,
        args.extra_opts || "",
      ].filter(Boolean).join(" ");

      let sshCmd;
      if (args.password) {
        const { stdout: check } = await runCmd("which sshpass 2>/dev/null || echo missing", "/tmp");
        if (check.includes("missing")) {
          return `❌ sshpass 未安装，请先运行: sudo apt-get install -y sshpass\n或使用 key_file 参数改用密钥认证`;
        }
        const escapedPass = args.password.replace(/'/g, "'\\''");
        sshCmd = `sshpass -p '${escapedPass}' ssh ${sshOpts} ${user}@${host}`;
      } else if (args.key_file) {
        sshCmd = `ssh ${sshOpts} -i '${args.key_file}' ${user}@${host}`;
      } else {
        sshCmd = `ssh ${sshOpts} ${user}@${host}`;
      }

      try {
        await runCmd(`tmux new-window -t ${session} -n '${windowName}' -d`, "/tmp");
      } catch {}

      const escapedCmd = sshCmd.replace(/'/g, "'\\''");
      await runCmd(`tmux send-keys -t '${paneTarget}' '${escapedCmd}' Enter`, "/tmp");

      // 等待连接建立（最多 10s）
      let connected = false;
      let lastOutput = "";
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const { stdout } = await runCmd(`tmux capture-pane -pt '${paneTarget}' -S -30`, "/tmp");
          lastOutput = stdout;
          if (stdout.match(/[$#>]\s*$/) || stdout.includes("Permission denied") || stdout.includes("Connection refused")) {
            connected = true;
            break;
          }
        } catch {}
      }

      const status = lastOutput.includes("Permission denied") ? "❌ 认证失败" :
                     lastOutput.includes("Connection refused") ? "❌ 连接被拒绝" :
                     connected ? "✅ 已连接" : "⏳ 连接中（可能需要更多时间）";

      return [
        `${status} SSH → ${user}@${host}:${port}`,
        `tmux pane: ${paneTarget}`,
        ``,
        `操作方式:`,
        `  发送命令: tmux_send(pane="${paneTarget}", text="your_command")`,
        `  读取输出: tmux_capture(pane="${paneTarget}", lines=50)`,
        `  关闭会话: tmux_kill(target="${session}:${windowName}")`,
        ``,
        `当前输出:\n${lastOutput.slice(-500)}`,
      ].join("\n");
    }

    // ── v1.5.0: Serial 会话（tmux 隔离）─────────────────────────────────────
    case "serial_session": {
      const session = args.session || "0";
      const device = args.device || "/dev/ttyUSB0";
      const baud = args.baud || 115200;
      const windowName = args.window_name || "serial";
      const paneTarget = `${session}:${windowName}.0`;

      if (!fs.existsSync(device)) {
        const { stdout: devList } = await runCmd("ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo '无串口设备'", "/tmp");
        return `❌ 串口设备不存在: ${device}\n可用设备:\n${devList}`;
      }

      const { stdout: minicomCheck } = await runCmd("which minicom 2>/dev/null || echo missing", "/tmp");
      if (minicomCheck.includes("missing")) {
        return `❌ minicom 未安装，请先运行: sudo apt-get install -y minicom`;
      }

      try {
        await runCmd(`tmux new-window -t ${session} -n '${windowName}' -d`, "/tmp");
      } catch {}

      const minicomCmd = `minicom -D ${device} -b ${baud} ${args.extra_opts || ""}`.trim();
      const escapedCmd = minicomCmd.replace(/'/g, "'\\''");
      await runCmd(`tmux send-keys -t '${paneTarget}' '${escapedCmd}' Enter`, "/tmp");

      await new Promise(r => setTimeout(r, 1500));
      let initOutput = "";
      try {
        const { stdout } = await runCmd(`tmux capture-pane -pt '${paneTarget}' -S -20`, "/tmp");
        initOutput = stdout;
      } catch {}

      return [
        `✅ minicom 已启动: ${device} @ ${baud}bps`,
        `tmux pane: ${paneTarget}`,
        ``,
        `操作方式:`,
        `  发送命令: tmux_send(pane="${paneTarget}", text="your_command")`,
        `  读取输出: tmux_capture(pane="${paneTarget}", lines=50)`,
        `  退出 minicom: tmux_send(pane="${paneTarget}", keys="C-a q")`,
        `  关闭 window: tmux_kill(target="${session}:${windowName}")`,
        ``,
        `当前输出:\n${initOutput.slice(-300)}`,
      ].join("\n");
    }

    // ── v1.5.0: env_check ────────────────────────────────────────────────────
    case "env_check": {
      const results = { commands: {}, python_modules: {}, ports: {} };

      for (const cmd of (args.commands || [])) {
        try {
          const { stdout } = await runCmd(`which ${cmd} 2>/dev/null || echo missing`, "/tmp");
          results.commands[cmd] = stdout.includes("missing")
            ? { available: false, hint: `sudo apt-get install -y ${cmd}` }
            : { available: true, path: stdout.trim() };
        } catch {
          results.commands[cmd] = { available: false };
        }
      }

      for (const mod of (args.python_modules || [])) {
        try {
          const { stdout } = await runCmd(
            `python3 -c "import ${mod}; print('ok')" 2>/dev/null || echo missing`,
            "/tmp"
          );
          results.python_modules[mod] = stdout.includes("missing")
            ? { available: false, hint: `pip install ${mod}` }
            : { available: true };
        } catch {
          results.python_modules[mod] = { available: false };
        }
      }

      for (const { host, port } of (args.ports || [])) {
        try {
          const { stdout } = await runCmd(
            `nc -zv -w 3 ${host} ${port} 2>&1 && echo open || echo closed`,
            "/tmp"
          );
          results.ports[`${host}:${port}`] = { open: stdout.includes("open") };
        } catch {
          results.ports[`${host}:${port}`] = { open: false };
        }
      }

      let out = "=== 环境检测结果 ===\n";
      if (Object.keys(results.commands).length) {
        out += "\n命令:\n";
        for (const [cmd, r] of Object.entries(results.commands)) {
          out += r.available ? `  ✅ ${cmd}: ${r.path}\n` : `  ❌ ${cmd}: 未安装  → ${r.hint || ""}\n`;
        }
      }
      if (Object.keys(results.python_modules).length) {
        out += "\nPython 模块:\n";
        for (const [mod, r] of Object.entries(results.python_modules)) {
          out += r.available ? `  ✅ ${mod}: 可用\n` : `  ❌ ${mod}: 不可用  → ${r.hint || ""}\n`;
        }
      }
      if (Object.keys(results.ports).length) {
        out += "\n端口连通性:\n";
        for (const [target, r] of Object.entries(results.ports)) {
          out += r.open ? `  ✅ ${target}: 开放\n` : `  ❌ ${target}: 不可达\n`;
        }
      }
      return out;
    }
    case "load_global_rules": {
      const globalRulesPath = path.join(os.homedir(), ".lmstudio", "global_rules.md");
      if (!fs.existsSync(globalRulesPath)) {
        return "⚠️ 未找到全局规则文件: " + globalRulesPath + "\n请提醒开发者创建此文件。";
      }
      return `📜 全局 Agent 规范已加载:\n\n${fs.readFileSync(globalRulesPath, "utf8")}`;
    }
    case "load_task_rules": {
      const task = args.task?.toLowerCase().trim();
      if (!task) return "❌ 参数缺失: load_task_rules 需要 'task' parameter（例如 'coding', 'review'）。";
      
      const rulesDir = path.join(os.homedir(), ".lmstudio", "tasks");
      const filePath = path.join(rulesDir, `${task}.md`);

      try {
        if (!fs.existsSync(rulesDir)) {
          fs.mkdirSync(rulesDir, { recursive: true });
          return `✅ 已创建规则目录 ${rulesDir}。请在其中放入对应的 .md 文件（例如 coding.md）。`;
        }
        if (!fs.existsSync(filePath)) {
          return `❌ 未找到任务规则文件: ${filePath}\n请确保您已在 ${rulesDir} 目录下创建了 ${task}.md 文件。`;
        }
        const content = fs.readFileSync(filePath, "utf8");
        return `✅ 已加载 [${task}] 规则内容：\n\n${content}`;
      } catch (err) {
        return `❌ 读取任务规则时出错: ${err.message}`;
      }
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "workspace-tools", version: "1.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {}, extra);
    logOp(name, args, result);
    return { content: [{ type: "text", text: String(result) }] };
  } catch (err) {
    logOp(name, args, `ERROR: ${err.message}`);
    return { content: [{ type: "text", text: `❌ ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
