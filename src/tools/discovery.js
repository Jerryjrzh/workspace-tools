// src/tools/discovery.js - Model-driven capability discovery (lazy discovery)
//
// 依据 docs/lazy_load_review4.md + review5：workspace_discover 不应是 "Tool Resolver"
// （query → 自动匹配 → promote），也不应是智能搜索器，而应像命令 `help`
// 一样返回 **候选能力目录**。模型负责理解、比较、选择；Runtime 只负责
// 加载与注入（promote）。
//
//   ❌ Query → Match → Promote            （旧：语义路由器）
//   ✅ Need → Discover → Capability Set → Model Select → Runtime promote → Use
//
// workspace_discover({ need }) → capabilities[] + example（候选能力目录 +
// 一个完整 lazy-load 示范，不自动选择、不自动 promote）
//
// ⚠️ review5：Discovery 结果本身就是一个 **lazy-load 教程**：
//    给模型看"有哪些能力" + 一个完整 Example（need → select → call），
//    让模型从示范中理解"发现 capability → 选择 → 调用"的过程，然后类推。
//
// 三个概念必须分离：
//   Discover        = 能力发现（workspace_discover，core 永远可见）
//   Promote         = 能力状态变化（capability set version++，Runtime 内部动作，
//                     不作为模型协议的一部分 —— review4 T5）
//   Dynamic Import  = 代码加载（registry.loadModule，已有）
//
// ⚠️ 静态 metadata index 绝不 import tool module ——
//    否则 discover 本身会打破 lazy-load。
import { TOOL_TO_MODULE, GROUP_MODULES } from './registry.js';

/**
 * Capability Catalog —— 可发现工具的静态元数据索引（不加载模块）。
 *
 * 仅收录默认未启用的 ops(运维)组工具；core 工具始终可见无需发现。
 *
 * ⚠️ review5：metadata 精简为 { name, summary }。不给每个 capability
 *    携带完整调用协议（when/call/instruction），只给名字 + 一句话描述，
 *    再由一个顶层 example 示范"如何选择并调用"。不做过度设计。
 *
 * group/moduleKey 仅用于 Runtime 内部路由（promote/import），不暴露给模型。
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
 *
 * ⚠️ review4 T5：promote 是 **Runtime 内部状态机**，不作为模型协议的一部分。
 *    模型只需知道 discover → choose → next turn use；它不调用 promote，
 *    Runtime 根据模型的下一轮选择自动执行 promote/activate/inject。
 *
 * module loaded ≠ tool promoted：
 *   - loadModule() 只负责代码加载（execution-time lazy loading）
 *   - promote()    才改变"模型可见能力集"，并递增 version
 *
 * ⚠️ in-session refresh：promote 后必须通知订阅方（server / Agent Runtime）
 *   使下一轮 LLM request 重新构建 tools，而不是复用 session 初始化时的
 *   immutable snapshot。否则 promote 只改变 capabilitySet，模型仍看不到新工具。
 */
export class ToolCapabilitySet {
  constructor() {
    this.promoted = new Set(); // promoted tool names
    this.version = 0;          // toolSetVersion：每次 promote 递增
    this._listeners = [];      // capabilityChanged 订阅者（server / runtime）
  }

  /** 提升一个已发现工具；返回是否发生变更（幂等） */
  promote(toolName) {
    if (!INDEX.has(toolName)) return false;
    if (this.promoted.has(toolName)) return false; // 已提升，version 不变
    this.promoted.add(toolName);
    this.version += 1;
    this._notifyChanged();
    return true;
  }

  /** 订阅 capability changed（promote 触发）。返回取消订阅函数。 */
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

/** 全局共享能力集（server ListTools / Runtime promote 共用同一实例） */
export const capabilitySet = new ToolCapabilitySet();

/**
 * CapabilityCatalog —— 静态能力目录（不 import module）。
 *
 * review4 T1/T3：输入 `need`，输出候选能力集；不做选择、不自动 promote。
 * 空结果返回 empty（不再有 no_match + retry hint）。
 *
 * ⚠️ review5：capabilities[] 只保留 { id, summary }。调用方式由顶层
 *    example 示范一次即可，其他能力不需要重复描述怎么调用。
 */
export const CapabilityRegistry = {
  /**
   * 按 need 描述返回候选能力目录（精简 schema: {id, summary}）。
   *
   * @param {string} [need] - 缺失的能力/任务描述；留空返回全部可发现候选
   * @returns {{ id, summary }[]}
   */
  listCapabilities(need = '') {
    const q = String(need || '').trim().toLowerCase();
    return DISCOVERABLE_TOOLS
      .filter((t) => {
        if (!q) return true;
        // 子串命中 name / summary（不做语义匹配，仅文本过滤）
        const haystack =
          `${t.name} ${t.summary || ''}`.toLowerCase();
        return q.split(/\s+/).every((word) => haystack.includes(word));
      })
      .map(({ name, summary }) => ({ id: name, summary }));
  },

  /** 单工具帮助（精简 schema: {id, summary}） */
  getCapability(toolName) {
    const meta = INDEX.get(toolName);
    if (!meta) return null;
    return { id: meta.name, summary: meta.summary };
  },

  /** 全部可发现能力（空 need） */
  all() { return this.listCapabilities(); }
};

/** discover(need) —— 兼容旧 API：返回候选能力目录（精简 schema）。 */
export function discover(need = '') {
  return CapabilityRegistry.listCapabilities(need);
}

/**
 * promoteTool(name) —— Runtime 内部动作：提升一个已发现工具到 capability set。
 *
 * ⚠️ review4 T5：不作为模型协议的一部分。由 Runtime（server CallTool guard）
 *    根据模型的下一轮选择自动调用，而非 workspace_discover 触发。
 *
 * @param {string} toolName
 * @returns {{ ok: boolean, changed: boolean, version: number } | null}
 */
export function promoteTool(toolName) {
  const meta = INDEX.get(toolName);
  if (!meta) return null;
  const changed = capabilitySet.promote(toolName);
  return { ok: true, changed, version: capabilitySet.version };
}

/**
 * 判断某工具是否属于可发现(ops)候选。
 *
 * @param {string} toolName
 */
export function isDiscoverable(toolName) {
  const key = TOOL_TO_MODULE[toolName];
  return Boolean(key && GROUP_MODULES.ops.includes(key));
}

// ── workspace_discover (core，永远可见) ───────────────────────────────

/**
 * review5：Discovery 返回一个完整 lazy-load 示范（example），
 * 让模型从"need → select → call"的示例中类推其他能力的使用方式。
 */
const DISCOVERY_EXAMPLE = {
  need: 'check the current directory',
  select: 'shell_run',
  call: 'shell_run({"command":"pwd"})'
};

/** core 工具：能力发现入口（Capability Discovery / Tool Help） */
export const discoveryTools = [
  {
    name: 'workspace_discover',
    description:
      'Dynamic capability manual for hidden (ops) tools. Use when the current task requires a ' +
      'capability not present in the currently available tools.\n\n' +
      'Call it with `need` to inspect candidate capabilities:\n' +
      '  workspace_discover({ need: "execute pwd" }) → { capabilities[], example }.\n' +
      'Capabilities are listed as name + summary. A single full example shows how to ' +
      'select a capability and call it; follow that pattern for the one you choose.\n\n' +
      'You compare and choose; do NOT guess a hidden tool name.\n\n' +
      'After choosing, call the selected tool directly in your next turn — it will be made available. ' +
      'Never repeatedly search for the same capability.',
    inputSchema: {
      type: 'object',
      properties: {
        need: { type: 'string', description: '缺失的能力/任务描述，如 "execute pwd" / "remote ssh"。留空返回全部候选' }
      },
      required: []
    }
  }
];

export async function handleDiscoveryTools(name, args = {}, context) {
  switch (name) {
    case 'workspace_discover': {
      const need = String(args.need || '').trim();

      // ── 返回候选能力目录（不做选择、不自动 promote）──────────────
      // review4 T3：空结果返回 empty，不再有 no_match + retry hint。
      const capabilities = CapabilityRegistry.listCapabilities(need);
      if (capabilities.length === 0) {
        return { status: 'empty', need, message: `未找到匹配 "${need}" 的能力。` };
      }

      // ── review5：返回 capabilities[] + example（完整 lazy-load 示范）──
      return {
        status: 'capabilities',
        capabilities,
        example: DISCOVERY_EXAMPLE,
        toolSetVersion: capabilitySet.version,
        message:
          `以上是匹配 "${need}" 的候选能力。请参考示例选择最合适的工具，` +
          `然后在下一轮直接调用它（无需显式 promote）。`
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
