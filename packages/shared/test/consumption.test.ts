import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/store.ts';
import { TranscriptParser } from '../src/transcript.ts';
import { requestCost, sharesList } from '../src/consumption.ts';
import { makeUsage } from '../src/usage.ts';
import { SID, assistantLines, text } from './fixtures.ts';

const at = (sec: number) => new Date(Date.UTC(2026, 9, 2, 20, 52, sec)).toISOString();
const parse = (lines: string[], agentId: string | null = null) => {
  const p = new TranscriptParser({ sessionId: SID, agentId, path: `/x/${SID}.jsonl` });
  return lines.flatMap((l) => p.parseLine(l));
};
/** Assistant line(s) carrying Claude Code's attribution fields. */
const attributed = (sec: number, id: string, attr: Record<string, string>, opts: { agentId?: string; model?: string } = {}) =>
  assistantLines(sec, id, [text('ok'), text('suite')], opts).map((l) => JSON.stringify({ ...JSON.parse(l), ...attr }));

describe('usage shares (like /usage)', () => {
  it('weighs requests like Claude Code: token prices × model tier', () => {
    const u = makeUsage(1, 2, 3, 4);
    expect(requestCost(u, 'claude-opus-5-5')).toBe((4 + 10 + 3 * 12.5 + 100) * 5);
    expect(requestCost(u, 'claude-haiku-4-5')).toBe(4 + 10 + 3 * 12.5 + 100);
    expect(requestCost(u, 'claude-fable-5-1')).toBe((4 + 10 + 3 * 12.5 + 100) * 10);
  });

  it('charges each request once to its skill, plugin, MCP server or sub-agent', () => {
    const lines = [
      ...assistantLines(1, 'plain', [text('rien')]),
      ...attributed(2, 'sk', { attributionSkill: 'ecc:tdd', attributionPlugin: 'ecc' }),
      ...attributed(3, 'mcp', { attributionMcpServer: 'blender' }),
    ];
    const sub = attributed(4, 'ag', { attributionAgent: 'ecc:code-reviewer', attributionPlugin: 'ecc' }, { agentId: 'ag1' });
    const s = new StateStore();
    const evs = [...parse(lines), ...parse(sub, 'ag1')];
    s.applyAll(evs);
    s.applyAll(evs); // replayed: no double count
    const sh = s.sessions.get(SID)!.usageShares;
    const one = sh.total / 4; // four identical requests
    expect(sh.skills).toEqual({ 'ecc:tdd': one });
    expect(sh.plugins).toEqual({ ecc: 2 * one });
    expect(sh.mcpServers).toEqual({ blender: one });
    expect(sh.agents).toEqual({ 'ecc:code-reviewer': one });
    expect(sh.subagents).toBe(one);
    expect(sharesList(sh.plugins, sh.total)).toEqual([{ name: 'ecc', pct: 50 }]);
  });

  it('a request whose usage grows (sub-agent stream snapshot) is recounted, not added twice', () => {
    const s = new StateStore();
    const ev = (output: number) => ({ sessionId: SID, at: 1, source: 'transcript' as const, kind: 'usage' as const, agentId: SID, messageId: 'm', model: 'claude-haiku-4-5', usage: makeUsage(0, output, 0, 0), attribution: { agent: null, skill: 'x', plugin: null, mcpServer: null } });
    s.applyAll([ev(3), ev(100)]);
    expect(s.sessions.get(SID)!.usageShares).toMatchObject({ total: 5000, skills: { x: 5000 } });
  });

  it('keeps the /context breakdown', () => {
    const line = JSON.stringify({
      type: 'system', subtype: 'local_command', sessionId: SID, timestamp: at(9),
      contextUsage: { total_tokens: 30_000, raw_max_tokens: 1_000_000, categories: [
        { name: 'MCP tools', tokens: 16_000, kind: 'used' },
        { name: 'MCP tools (deferred)', tokens: 270_000, kind: 'deferred' },
        { name: 'Free space', tokens: 900_000, kind: 'free' },
      ] },
    });
    const s = new StateStore();
    s.applyAll(parse([line]));
    expect(s.sessions.get(SID)!.contextUsage).toMatchObject({ total: 30_000, window: 1_000_000, categories: [{ name: 'MCP tools', tokens: 16_000 }] });
  });
});
