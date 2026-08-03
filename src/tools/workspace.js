import { setSessionWorkspace, clearSessionWorkspace, getWorkspaceInfo } from '../runtime/executors/workspaceExecutor.js';

export const workspaceTools = [
  { name: 'workspace_set', description: '设置当前会话的工作目录', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'workspace_clear', description: '清除当前会话的 workspace 设置', inputSchema: { type: 'object', properties: {} } },
  { name: 'workspace_info', description: '显示当前会话工作区路径及最近使用历史', inputSchema: { type: 'object', properties: { subpath: { type: 'string' }, all: { type: 'boolean' } } } }
];

export async function handleWorkspaceTools(name, args, context) {
  const sessionId = (typeof context === 'object' && context !== null)
    ? (context.sessionId || context.conversation_id || 'default')
    : (context || 'default');
  switch (name) {
    case 'workspace_set':
      return setSessionWorkspace(sessionId, args.path);
    case 'workspace_clear':
      clearSessionWorkspace(sessionId);
      return `✅ 已清除 workspace 设置，当前使用进程 cwd: ${process.cwd()}`;
    case 'workspace_info': {
      const info = getWorkspaceInfo(sessionId);
      return `当前 Workspace: ${info.workspace || '未设置'}${info.isSet ? ' (本会话已设置)' : ''}`;
    }
    default:
      throw new Error(`未知 workspace 工具: ${name}`);
  }
}
