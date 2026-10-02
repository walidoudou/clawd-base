import { structuredPatch } from 'diff';
import type { FileChange, FileOperation, Hunk } from './types.ts';
import { LIMITS } from './truncate.ts';

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
export const READ_TOOLS = new Set(['Read', 'NotebookRead']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate/normalize a `structuredPatch` array coming from a tool result. */
export function normalizeHunks(raw: unknown): Hunk[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Hunk[] = [];
  for (const h of raw) {
    if (!h || typeof h !== 'object') return null;
    const o = h as Record<string, unknown>;
    if (!isNum(o['oldStart']) || !isNum(o['newStart']) || !Array.isArray(o['lines'])) return null;
    const lines = (o['lines'] as unknown[]).filter((l): l is string => typeof l === 'string');
    out.push({
      oldStart: o['oldStart'],
      oldLines: isNum(o['oldLines']) ? o['oldLines'] : lines.filter((l) => !l.startsWith('+')).length,
      newStart: o['newStart'],
      newLines: isNum(o['newLines']) ? o['newLines'] : lines.filter((l) => !l.startsWith('-')).length,
      lines,
    });
  }
  return out;
}

export function countHunks(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/** Line diff between two full texts, 3 lines of context. */
export function diffTexts(oldText: string, newText: string, context = 3): Hunk[] {
  if (oldText === newText) return [];
  const p = structuredPatch('a', 'b', oldText, newText, '', '', { context });
  return p.hunks
    .map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines.filter((l) => !l.startsWith('\\')),
    }))
    .filter((h) => h.lines.length > 0);
}

/** 1-based line number of a character offset. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Hunks for an `old_string → new_string` replacement when no structured patch exists.
 * `fileAfter` (content after the edit) is used to locate line numbers; when it is
 * unknown, line numbers are 0 (unknown).
 */
export function diffFromStrings(oldString: string, newString: string, fileAfter: string | null): Hunk[] {
  const local = diffTexts(oldString, newString, 0);
  const idx = fileAfter !== null && newString.length > 0 ? fileAfter.indexOf(newString) : -1;
  if (idx < 0) return local.map((h) => ({ ...h, oldStart: 0, newStart: 0 }));
  const base = lineOfOffset(fileAfter as string, idx) - 1;
  return local.map((h) => ({ ...h, oldStart: h.oldStart + base, newStart: h.newStart + base }));
}

/** Compact label of touched line ranges in the new file, e.g. "L12-18, L40". */
export function rangesLabel(hunks: readonly Hunk[]): string {
  const parts: string[] = [];
  for (const h of hunks) {
    if (h.newStart <= 0) continue;
    // Narrow to the changed lines (skip leading/trailing context).
    let line = h.newStart;
    let first = -1;
    let last = -1;
    for (const l of h.lines) {
      if (l.startsWith('-')) {
        if (first < 0) first = line;
        last = Math.max(last, line);
        continue;
      }
      if (l.startsWith('+')) {
        if (first < 0) first = line;
        last = line;
      }
      line++;
    }
    if (first < 0) continue;
    parts.push(last > first ? `L${first}-${last}` : `L${first}`);
  }
  return parts.join(', ');
}

export function capHunks(hunks: Hunk[], maxLines: number = LIMITS.hunkLinesPerChange): { hunks: Hunk[]; truncated: boolean } {
  let budget = maxLines;
  const out: Hunk[] = [];
  for (const h of hunks) {
    if (budget <= 0) return { hunks: out, truncated: true };
    if (h.lines.length <= budget) {
      out.push(h);
      budget -= h.lines.length;
    } else {
      out.push({ ...h, lines: h.lines.slice(0, budget) });
      return { hunks: out, truncated: true };
    }
  }
  return { hunks: out, truncated: false };
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function filePathOf(input: Record<string, unknown> | null | undefined, result?: unknown): string | null {
  const r = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  return str(input?.['file_path']) ?? str(input?.['notebook_path']) ?? str(input?.['path']) ?? str(r['filePath']) ?? null;
}

export interface ResolveDiffInput {
  toolName: string;
  input: Record<string, unknown>;
  /** Structured tool result (toolUseResult / tool_response), if any. */
  result?: unknown;
  /** File content before the call. undefined = unknown, null = file did not exist. */
  before?: string | null;
  /** File content after the call (read from disk), if known. */
  after?: string | null;
}

export interface ResolvedDiff {
  path: string;
  operation: FileOperation;
  hunks: Hunk[];
  diffSource: FileChange['diffSource'];
}

/** Compute the most accurate diff available for an Edit/MultiEdit/Write call. */
export function resolveFileDiff(p: ResolveDiffInput): ResolvedDiff | null {
  const path = filePathOf(p.input, p.result);
  if (!path) return null;
  const r = p.result && typeof p.result === 'object' && !Array.isArray(p.result) ? (p.result as Record<string, unknown>) : {};
  const isWrite = p.toolName === 'Write';
  const created =
    isWrite && (r['type'] === 'create' || p.before === null || (p.before === undefined && r['originalFile'] === null && r['type'] !== 'update'));
  const operation: FileOperation = isWrite ? (created ? 'create' : 'write') : 'edit';

  // 1. Structured patch from the tool result (most accurate, has line numbers).
  const sp = normalizeHunks(r['structuredPatch']);
  if (sp && (sp.length > 0 || !isWrite)) {
    if (sp.length > 0) return { path, operation, hunks: sp, diffSource: 'structuredPatch' };
  }

  // 2. Snapshot / originalFile vs new content.
  const before = p.before !== undefined ? p.before : (str(r['originalFile']) ?? (r['originalFile'] === null ? null : undefined));
  let after: string | null | undefined = p.after;
  if ((after === undefined || after === null) && isWrite) after = str(p.input['content']) ?? str(r['content']);
  if (before !== undefined && typeof after === 'string') {
    return { path, operation, hunks: diffTexts(before ?? '', after), diffSource: 'snapshot' };
  }

  // 3. Strings from the tool input.
  const fileAfter = typeof after === 'string' ? after : null;
  if (isWrite) {
    const content = str(p.input['content']) ?? '';
    return { path, operation, hunks: diffTexts('', content), diffSource: 'strings' };
  }
  const edits: Array<{ old: string; new: string }> = [];
  if (Array.isArray(p.input['edits'])) {
    for (const e of p.input['edits'] as unknown[]) {
      if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        edits.push({ old: str(o['old_string']) ?? '', new: str(o['new_string']) ?? '' });
      }
    }
  } else if (typeof p.input['old_string'] === 'string' || typeof p.input['new_string'] === 'string') {
    edits.push({ old: str(p.input['old_string']) ?? '', new: str(p.input['new_string']) ?? '' });
  } else if (typeof p.input['new_source'] === 'string') {
    edits.push({ old: '', new: str(p.input['new_source']) ?? '' });
  }
  if (edits.length === 0) return { path, operation, hunks: [], diffSource: 'none' };
  const hunks = edits.flatMap((e) => diffFromStrings(e.old, e.new, fileAfter));
  hunks.sort((a, b) => a.newStart - b.newStart);
  return { path, operation, hunks, diffSource: 'strings' };
}

export function makeFileChange(
  base: { id: string; sessionId: string; agentId: string; at: number },
  d: ResolvedDiff,
): FileChange {
  const { hunks, truncated } = capHunks(d.hunks);
  // Counts use the full diff, not the capped one.
  const { added, removed } = countHunks(d.hunks);
  return { ...base, path: d.path, operation: d.operation, hunks, added, removed, truncated, diffSource: d.diffSource };
}

export function makeReadChange(base: { id: string; sessionId: string; agentId: string; at: number }, path: string): FileChange {
  return { ...base, path, operation: 'read', hunks: [], added: 0, removed: 0, truncated: false, diffSource: 'none' };
}
