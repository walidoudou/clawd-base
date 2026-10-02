import type { TokenUsage } from './types.ts';

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function makeUsage(input: number, output: number, cacheCreate: number, cacheRead: number): TokenUsage {
  return { input, output, cacheCreate, cacheRead, total: input + output + cacheCreate + cacheRead };
}

/** Convert an Anthropic API `usage` object (as found in transcripts) to TokenUsage. */
export function usageFromApi(u: unknown): TokenUsage | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  return makeUsage(
    num(o['input_tokens']),
    num(o['output_tokens']),
    num(o['cache_creation_input_tokens']),
    num(o['cache_read_input_tokens']),
  );
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return makeUsage(a.input + b.input, a.output + b.output, a.cacheCreate + b.cacheCreate, a.cacheRead + b.cacheRead);
}

export function sumUsage(list: Iterable<TokenUsage>): TokenUsage {
  let acc = makeUsage(0, 0, 0, 0);
  for (const u of list) acc = addUsage(acc, u);
  return acc;
}

function sameUsage(a: TokenUsage, b: TokenUsage): boolean {
  return a.input === b.input && a.output === b.output && a.cacheCreate === b.cacheCreate && a.cacheRead === b.cacheRead;
}

/**
 * Deduplicating usage accumulator.
 *
 * Claude Code writes one transcript line per content block of an assistant
 * message, repeating the same `usage` on each line (see docs/FINDINGS.md).
 * We therefore key usage by message id; the last record for an id wins.
 */
export class UsageLedger {
  private readonly byMessage = new Map<string, TokenUsage>();
  private totalCache: TokenUsage = makeUsage(0, 0, 0, 0);

  /** Records usage for a message. Returns the change in total (null if nothing changed). */
  record(messageId: string, usage: TokenUsage): TokenUsage | null {
    const prev = this.byMessage.get(messageId);
    if (prev && sameUsage(prev, usage)) return null;
    this.byMessage.set(messageId, usage);
    const delta = prev
      ? makeUsage(usage.input - prev.input, usage.output - prev.output, usage.cacheCreate - prev.cacheCreate, usage.cacheRead - prev.cacheRead)
      : usage;
    this.totalCache = addUsage(this.totalCache, delta);
    return delta;
  }

  get total(): TokenUsage {
    return this.totalCache;
  }

  get messageCount(): number {
    return this.byMessage.size;
  }
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
