import type { TokenUsage, UsageShares } from './types.ts';

/** Who a request is attributed to, as Claude Code writes it on each assistant line (2.1.28x+). */
export interface Attribution {
  agent: string | null;
  skill: string | null;
  plugin: string | null;
  mcpServer: string | null;
}

/** Model price tier used by Claude Code's `/usage` (2.1.289): Haiku 1, Sonnet and others 3, Opus 5, Fable 10. */
function modelTier(model: string | null): number {
  const m = model?.toLowerCase() ?? '';
  if (!m) return 3;
  if (m.includes('fable')) return 10;
  if (m.includes('opus')) return 5;
  if (m.includes('haiku')) return 1;
  return 3;
}

/** Weight of one request, like `/usage`: relative token prices (cache read 1, input 10, cache write 12.5, output 50) × model tier. */
export function requestCost(u: TokenUsage, model: string | null): number {
  return (u.cacheRead + u.input * 10 + u.cacheCreate * 12.5 + u.output * 50) * modelTier(model);
}

export function emptyShares(): UsageShares {
  return { total: 0, subagents: 0, longContext: 0, cacheMiss: 0, agents: {}, skills: {}, plugins: {}, mcpServers: {} };
}

export interface ChargedRequest {
  usage: TokenUsage;
  model: string | null;
  sub: boolean;
  attribution: Attribution | null;
}

function bump(m: Record<string, number>, key: string | null, n: number): void {
  if (!key) return;
  const v = (m[key] ?? 0) + n;
  // Floating point leftovers of a removed charge.
  if (v > 1e-6) m[key] = v;
  else delete m[key];
}

/** Add (sign 1) or remove (sign −1) one request, with the same rules as `/usage`. */
export function addRequest(s: UsageShares, r: ChargedRequest, sign: 1 | -1): void {
  const cost = requestCost(r.usage, r.model) * sign;
  s.total += cost;
  if (r.sub) s.subagents += cost;
  if (r.usage.input + r.usage.cacheCreate + r.usage.cacheRead > 150_000) s.longContext += cost;
  if (r.usage.input > 100_000) s.cacheMiss += cost;
  const a = r.attribution;
  if (!a) return;
  // A skill run by a sub-agent counts for that agent, not in the skills list.
  if (a.agent) bump(s.agents, a.skill ?? a.agent, cost);
  else bump(s.skills, a.skill, cost);
  bump(s.plugins, a.plugin, cost);
  bump(s.mcpServers, a.mcpServer, cost);
}

/** Entries as rounded percentages of the total, biggest first, 0 % dropped (like `/usage`). */
export function sharesList(m: Record<string, number>, total: number): Array<{ name: string; pct: number }> {
  if (total <= 0) return [];
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => ({ name, pct: Math.round((v / total) * 100) }))
    .filter((x) => x.pct > 0);
}
