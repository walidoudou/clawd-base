import { describe, expect, it } from 'vitest';
import { UsageLedger, contextWindowFor, formatTokens, makeUsage, usageFromApi } from '../src/usage.ts';
import { StateStore } from '../src/store.ts';
import { TranscriptParser } from '../src/transcript.ts';
import { SID, assistantLines, text, thinking, toolUse } from './fixtures.ts';

describe('usageFromApi', () => {
  it('maps API fields and computes total', () => {
    expect(usageFromApi({ input_tokens: 2, output_tokens: 300, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 })).toEqual(makeUsage(2, 300, 10, 5));
    expect(usageFromApi({ input_tokens: 'x', output_tokens: -3 })).toEqual(makeUsage(0, 0, 0, 0));
    expect(usageFromApi(null)).toBeNull();
  });
});

describe('UsageLedger (deduplication by message id)', () => {
  it('counts a message once even if recorded several times', () => {
    const l = new UsageLedger();
    const u = makeUsage(2, 300, 51832, 40868);
    expect(l.record('msg_1', u)).toEqual(u);
    expect(l.record('msg_1', u)).toBeNull();
    expect(l.record('msg_1', u)).toBeNull();
    expect(l.total).toEqual(u);
    expect(l.messageCount).toBe(1);
  });

  it('last record wins when a later line carries different usage', () => {
    const l = new UsageLedger();
    l.record('m', makeUsage(1, 10, 0, 0));
    expect(l.record('m', makeUsage(1, 50, 0, 0))).toEqual(makeUsage(0, 40, 0, 0));
    l.record('n', makeUsage(2, 5, 0, 0));
    expect(l.total).toEqual(makeUsage(3, 55, 0, 0));
  });

  it('end to end: a 4-block assistant message is counted once by the store', () => {
    const store = new StateStore();
    const parser = new TranscriptParser({ sessionId: SID, agentId: null });
    const lines = [
      ...assistantLines(1, 'msg_X', [thinking, text('a'), toolUse('t1', 'Bash', {}), toolUse('t2', 'Bash', {})], { out: 498 }),
      ...assistantLines(2, 'msg_Y', [thinking, text('b')], { out: 100 }),
    ];
    for (const l of lines) store.applyAll(parser.parseLine(l));
    // Replaying the same file (e.g. after restart) must not double count either.
    const again = new TranscriptParser({ sessionId: SID, agentId: null });
    for (const l of lines) store.applyAll(again.parseLine(l));
    const main = store.agents.get(SID);
    expect(main?.usage.output).toBe(598);
    expect(main?.usage.cacheRead).toBe(2 * 40868);
    expect(main?.usage.total).toBe(2 * (2 + 51832 + 40868) + 598);
  });
});

describe('formatTokens', () => {
  it('formats compactly', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(45678)).toBe('46k');
    expect(formatTokens(6190573)).toBe('6.19M');
  });
});

describe('contextWindowFor (Claude Code model catalog)', () => {
  it('1M for Opus 4.7+, Sonnet 5+, Fable and [1m] models; 200k otherwise', () => {
    for (const m of ['claude-opus-5-5', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-sonnet-4-6[1m]', 'Opus 4.6 (1M context)']) expect(contextWindowFor(m)).toBe(1_000_000);
    for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001', null, 'opus']) expect(contextWindowFor(m)).toBe(200_000);
  });
});
