/** Memory caps shared by server and simulator. */
export const LIMITS = {
  toolOutputChars: 4000,
  inputStringChars: 2000,
  promptChars: 100_000,
  snapshotBytes: 512 * 1024,
  hunkLinesPerChange: 600,
  toolsPerAgent: 2000,
  fileChangesPerSession: 3000,
  logRing: 500,
  replayRing: 2000,
} as const;

export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [+${s.length - max} caractères]`;
}

/** Deep-copy a JSON-ish value, truncating long strings and large arrays. */
export function truncateValue(v: unknown, maxString: number = LIMITS.inputStringChars, depth = 0): unknown {
  if (typeof v === 'string') return truncateText(v, maxString);
  if (v === null || typeof v !== 'object') return v;
  if (depth > 4) return '[…]';
  if (Array.isArray(v)) {
    const out = v.slice(0, 50).map((x) => truncateValue(x, maxString, depth + 1));
    if (v.length > 50) out.push(`[+${v.length - 50} éléments]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = truncateValue(val, maxString, depth + 1);
  return out;
}

export function truncateRecord(v: unknown, maxString: number = LIMITS.inputStringChars): Record<string, unknown> {
  const t = truncateValue(v, maxString);
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : { value: t };
}

/** Turn any tool output (string, content blocks, object) into display text. */
export function stringifyOutput(v: unknown, max: number = LIMITS.toolOutputChars): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return truncateText(v, max);
  if (Array.isArray(v)) {
    const texts = v
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') return (b as { text: string }).text;
        if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean);
    if (texts.length) return truncateText(texts.join('\n'), max);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['stdout'] === 'string' || typeof o['stderr'] === 'string') {
      const parts = [o['stdout'], o['stderr']].filter((x): x is string => typeof x === 'string' && x.length > 0);
      return truncateText(parts.join('\n'), max);
    }
    try {
      return truncateText(JSON.stringify(truncateValue(o, 400)), max);
    } catch {
      return '[objet]';
    }
  }
  return truncateText(String(v), max);
}
