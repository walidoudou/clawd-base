/** Tool → category used for colours (timeline), stations (scene) and stats. */
export type ToolCategory = 'read' | 'edit' | 'bash' | 'agent' | 'other';

const READ = /^(Read|Grep|Glob|LS|NotebookRead|WebFetch|WebSearch|ToolSearch|ListMcpResourcesTool|ReadMcpResourceTool)$/;
const EDIT = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
const BASH = /^(Bash|PowerShell|BashOutput|KillShell|Monitor|TaskOutput|TaskStop)$/;
const AGENT = /^(Agent|Task|Workflow|SendMessage)$/;

export function toolCategory(name: string): ToolCategory {
  if (EDIT.test(name)) return 'edit';
  if (READ.test(name)) return 'read';
  if (BASH.test(name) || name.startsWith('mcp__')) return 'bash';
  if (AGENT.test(name)) return 'agent';
  return 'other';
}

export const CATEGORY_COLOR: Record<ToolCategory | 'error', string> = {
  read: '#6cc4ff',
  edit: '#f2c14e',
  bash: '#7ee08f',
  agent: '#c58cff',
  other: '#a99fb8',
  error: '#ff6b6b',
};

/** Short display name for MCP tools: mcp__server__tool → server·tool. */
export function toolDisplayName(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  return `${parts[1] ?? 'mcp'}·${parts.slice(2).join('_')}`;
}
