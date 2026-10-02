import { describe, expect, it } from 'vitest';
import { capHunks, countHunks, diffFromStrings, diffTexts, lineOfOffset, makeFileChange, normalizeHunks, rangesLabel, resolveFileDiff } from '../src/diff.ts';

describe('diffTexts', () => {
  it('returns no hunks for identical text', () => {
    expect(diffTexts('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('produces line numbers and +/- counts', () => {
    const h = diffTexts('a\nb\nc\nd\n', 'a\nB1\nB2\nc\nd\n');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(h[0]?.lines).toEqual([' a', '-b', '+B1', '+B2', ' c', ' d']);
    expect(countHunks(h)).toEqual({ added: 2, removed: 1 });
  });

  it('counts a brand-new file as all additions', () => {
    expect(countHunks(diffTexts('', 'x\ny\nz\n'))).toEqual({ added: 3, removed: 0 });
  });

  it('ignores "no newline at end of file" markers', () => {
    const h = diffTexts('a', 'b');
    expect(h.flatMap((x) => x.lines).some((l) => l.startsWith('\\'))).toBe(false);
  });
});

describe('diffFromStrings (fallback without structuredPatch)', () => {
  const after = 'line1\nline2\nNEW A\nNEW B\nline5\n';
  it('locates the replacement in the file to get line numbers', () => {
    const h = diffFromStrings('old', 'NEW A\nNEW B', after);
    expect(h[0]?.newStart).toBe(3);
    expect(countHunks(h)).toEqual({ added: 2, removed: 1 });
  });
  it('uses 0 (unknown) line numbers when the file content is unknown', () => {
    expect(diffFromStrings('old', 'new', null)[0]).toMatchObject({ newStart: 0, oldStart: 0 });
  });
  it('lineOfOffset is 1-based', () => {
    expect(lineOfOffset('a\nb\nc', 0)).toBe(1);
    expect(lineOfOffset('a\nb\nc', 4)).toBe(3);
  });
});

describe('normalizeHunks', () => {
  it('accepts structuredPatch arrays and rejects garbage', () => {
    expect(normalizeHunks([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }])).toHaveLength(1);
    expect(normalizeHunks([{ foo: 1 }])).toBeNull();
    expect(normalizeHunks('x')).toBeNull();
  });
});

describe('resolveFileDiff priority', () => {
  const sp = [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, lines: ['-a', '+b'] }];
  it('prefers structuredPatch', () => {
    const d = resolveFileDiff({ toolName: 'Edit', input: { file_path: '/f', old_string: 'a', new_string: 'b' }, result: { structuredPatch: sp }, before: 'zzz', after: 'yyy' });
    expect(d).toMatchObject({ diffSource: 'structuredPatch', operation: 'edit', path: '/f' });
  });
  it('falls back to the PreToolUse snapshot vs disk', () => {
    const d = resolveFileDiff({ toolName: 'Edit', input: { file_path: '/f', old_string: 'b', new_string: 'X' }, result: 'ok', before: 'a\nb\nc\n', after: 'a\nX\nc\n' });
    expect(d?.diffSource).toBe('snapshot');
    expect(d?.hunks[0]?.lines).toEqual([' a', '-b', '+X', ' c']);
  });
  it('Write over an existing file diffs snapshot vs new content', () => {
    const d = resolveFileDiff({ toolName: 'Write', input: { file_path: '/f', content: 'a\nB\n' }, before: 'a\nb\n' });
    expect(d).toMatchObject({ operation: 'write', diffSource: 'snapshot' });
    expect(countHunks(d?.hunks ?? [])).toEqual({ added: 1, removed: 1 });
  });
  it('Write of a new file (snapshot null) is a create', () => {
    const d = resolveFileDiff({ toolName: 'Write', input: { file_path: '/f', content: 'a\nb\n' }, before: null });
    expect(d?.operation).toBe('create');
    expect(countHunks(d?.hunks ?? [])).toEqual({ added: 2, removed: 0 });
  });
  it('uses old/new strings as last resort (MultiEdit edits[])', () => {
    const d = resolveFileDiff({ toolName: 'MultiEdit', input: { file_path: '/f', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd\ne' }] } });
    expect(d?.diffSource).toBe('strings');
    expect(countHunks(d?.hunks ?? [])).toEqual({ added: 3, removed: 2 });
  });
  it('returns null without a path', () => {
    expect(resolveFileDiff({ toolName: 'Edit', input: {} })).toBeNull();
  });
});

describe('rangesLabel and caps', () => {
  it('labels changed line ranges in the new file', () => {
    const h = diffTexts('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n', '1\nX\n3\n4\n5\n6\n7\n8\n9\n10\nY\nZ\n');
    expect(rangesLabel(h)).toBe('L2, L11-12');
  });
  it('caps hunk lines but keeps true counts', () => {
    const big = diffTexts('', Array.from({ length: 1000 }, (_, i) => `l${i}`).join('\n'));
    const c = makeFileChange({ id: 't', sessionId: 's', agentId: 'a', at: 0 }, { path: '/f', operation: 'create', hunks: big, diffSource: 'snapshot' });
    expect(c.added).toBe(1000);
    expect(c.truncated).toBe(true);
    expect(c.hunks.flatMap((h) => h.lines).length).toBeLessThanOrEqual(600);
    expect(capHunks(big, 5000).truncated).toBe(false);
  });
});
