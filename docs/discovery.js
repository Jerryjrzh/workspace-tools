// src/tools/discovery.js - Model-driven capability discovery (lazy discovery)
//
// 依据最新设计：workspace_discover 是一个轻量级 lazy-load 示范目录。
// 核心目的：给模型展示“有哪些能力 (id + summary)” + “一个完整的调用示范 (example)”，
// 依靠模型自身的 pattern-matching 类推完成选择与调用。
//
// 三个概念分离：
//   Discover        = 能力发现（workspace_discover，core 永远可见）
//   Promote         = 能力状态变化（Runtime 内部动作，不暴露给模型协议）
//   Dynamic Import  = 代码加载（registry.loadModule，已有）
//
// ⚠️ 静态 metadata index 绝不 import tool module ——
//    否则 discover 本身会打破 lazy-load。
import { TOOL_TO_MODULE, GROUP_MODULES } from './registry.js';

/** 标准 Lazy-load 示例：让模型理解“需求 -> 挑选 capability -> 发起 tool_call”的完整闭环 */
export const DISCOVERY_EXAMPLE = {
  need: 'check the current directory',
  select: 'shell_run',
  call: 'shell_run({"command":"pwd"})'
};

/**
 * Capability Catalog —— 可发现工具的静态元数据索引（不加载模块）。
 * 仅收录默认未启用的 ops(运维)组工具；core 工具始终可见无需发现。
 *
 * 字段极简：只保留 id(name) 与 summary，移除繁琐的 usage/examples 冗余。
 */
export const DISCOVERABLE_TOOLS = [
  // ── shell (ops) ─────────────────────────────
  { name: 'shell_run',       group: 'ops', moduleKey: 'shell',
    summary: 'Execute a local shell command.' },
  { name: 'process_start',   group: 'ops', moduleKey: 'shell',
    summary: 'Start a background process / service.' },
  { name: 'process_output',  group: 'ops', moduleKey: 'shell',
    summary: 'Read output of a background process.' },
  { name: 'process_kill',    group: 'ops', moduleKey: 'shell',
    summary: 'Terminate a background process.' },
  { name: 'process_list_bg', group: 'ops', moduleKey: 'shell',
    summary: 'List all background processes.' },

  // ── tmux (ops) ─────────────────────────────
  { name: 'tmux_run',        group: 'ops', moduleKey: 'tmux',
    summary: 'Execute commands in a persistent tmux session.' },
  { name: 'tmux_send',       group: 'ops', moduleKey: 'tmux',
    summary: 'Send keys/text to a tmux session.' },
  { name: 'tmux_capture',    group: 'ops', moduleKey: 'tmux',
    summary: 'Capture a tmux pane output.' },
  { name: 'tmux_list',       group: 'ops', moduleKey: 'tmux',
    summary: 'List tmux sessions/windows.' },
  { name: 'tmux_new_session',group: 'ops', moduleKey: 'tmux',
    summary: 'Create a new tmux session.' },
  { name: 'tmux_kill',       group: 'ops', moduleKey: 'tmux',
    summary: 'Terminate a tmux session.' },

  // ── session ops (ssh / serial) ─────────────
  { name: 'ssh_session',     group: 'ops', moduleKey: 'session',
    summary: 'Execute commands on a remote host over SSH.' },
  { name: 'serial_session',  group: 'ops', moduleKey: 'session',
    summary: 'Establish a serial (UART) console session.' },

  // ── env (ops) ─────────────────────────────
  { name: 'env_check',       group: 'ops', moduleKey: 'env',
    summary: 'Check system environment variables / toolchain state.' }
];

/** 静态索引：name → metadata（快速定位，不 import） */
const INDEX = new Map(DISCOVERABLE_TOOLS.map((t) => [t.name, t]));

/**
 * ToolCapabilitySet —— 已提升(promoted)工具集合 + toolSetVersion。
 * Runtime 内部状态机，不作为模型协议的一部分。
 */
export class ToolCapabilitySet {
  constructor() {
    this.promoted = new Set(); // promoted tool names
    this.version = 0;          // toolSetVersion：每次 promote 递增
    this._listeners = [];      // capabilityChanged 订阅者
  }

  /** 提升一个已发现工具；返回是否发生变更（幂等） */
  promote(toolName) {
    if (!INDEX.has(toolName)) return false;
    if (this.promoted.has(toolName)) return false;
    this.promoted.add(toolName);
    this.version += 1;
    this._notifyChanged();
    return true;
  }

  /** 订阅 capability changed（promote 触发） */
  onChanged(listener) {
    this._listeners.push(listener);
    return () => {
      const i = this._listeners.indexOf(listener);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  /** 通知所有订阅方：capability set 已变化，需刷新 tools schema */
  _notifyChanged() {
    for (const listener of [...this._listeners]) {
      try { listener({ toolSetVersion: this.version }); }
      catch (err) { console.warn('[discovery] capabilityChanged listener error:', err?.message || err); }
    }
  }

  has(toolName) { return this.promoted.has(toolName); }
  getPromoted() { return [...this.promoted]; }
  toJSON() {
    return { promoted: [...this.promoted], toolSetVersion: this.version };
  }
}

/** 全局共享能力集 */
export const capabilitySet = new ToolCapabilitySet();

/**
 * CapabilityRegistry —— 静态能力目录。
 */
export const CapabilityRegistry = {
  /**
   * 按 need 描述返回候选能力目录（仅含 id + summary）。
   * @param {string} [need] - 任务/需求描述；留空返回全部候选
   * @returns {{ id: string, summary: string }[]}
   */
  listCapabilities(need = '') {
    const q = String(need || '').trim().toLowerCase();
    return DISCOVERABLE_TOOLS
      .filter((t) => {
        if (!q) return true;
        const haystack = `${t.name} ${t.summary || ''}`.toLowerCase();
        return q.split(/\s+/).every((word) => haystack.includes(word));
      })
      .map(({ name, summary }) => ({ id: name, summary }));
  },

  /** 单工具信息 */
  getCapability(toolName) {
    const meta = INDEX.get(toolName);
    if (!meta) return null;
    return { id: meta.name, summary: meta.summary };
  },

  /** 全部可发现能力 */
  all() { return this.listCapabilities(); }
};

/** discover(need) —— 兼容旧调用 */
export function discover(need = '') {
  return CapabilityRegistry.listCapabilities(need);
}

/**
 * promoteTool(name) —— Runtime 内部动作：提升一个已发现工具。
 */
export function promoteTool(toolName) {
  const meta = INDEX.get(toolName);
  if (!meta) return null;
  const changed = capabilitySet.promote(toolName);
  return { ok: true, changed, version: capabilitySet.version };
}

/** 判断某工具是否属于可发现(ops)候选 */
export function isDiscoverable(toolName) {
  const key = TOOL_TO_MODULE[toolName];
  return Boolean(key && GROUP_MODULES.ops.includes(key));
}

// ── workspace_discover (core，永远可见) ───────────────────────────────

export const discoveryTools = [
  {
    name: 'workspace_discover',
    description:
      'Dynamic capability discovery for non-visible tools. When a required capability is not visible, ' +
      'use workspace_discover, select the best matching capability, and follow its example to call it.',
    inputSchema: {
      type: 'object',
      properties: {
        need: {
          type: 'string',
          description: 'Description of the required capability or task (e.g. "execute command", "remote ssh"). Leave empty to list all.'
        }
      },
      required: []
    }
  }
];

export async function handleDiscoveryTools(name, args = {}, context) {
  switch (name) {
    case 'workspace_discover': {
      const need = String(args.need || '').trim();
      const capabilities = CapabilityRegistry.listCapabilities(need);

      if (capabilities.length === 0) {
        return {
          status: 'empty',
          need,
          message: `未找到匹配 "${need}" 的能力。`
        };
      }

      // 仅返回精简目录与范例，让模型直接 pattern-match
      return {
        status: 'capabilities',
        capabilities,
        example: DISCOVERY_EXAMPLE
      };
    }
    default:
      throw new Error(`未知 discovery 工具: ${name}`);
  }
}

export default {
  DISCOVERABLE_TOOLS,
  CapabilityRegistry,
  ToolCapabilitySet,
  capabilitySet,
  discover,
  promoteTool,
  isDiscoverable
};