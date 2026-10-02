import { open, stat } from 'node:fs/promises';
import { LIMITS } from '@dash/shared';

/**
 * Read a text file if it exists and is under the size cap.
 * Returns null when the file does not exist, undefined when unknown (too big / unreadable / binary).
 */
export async function readCapped(path: string, maxBytes: number = LIMITS.snapshotBytes): Promise<string | null | undefined> {
  try {
    const st = await stat(path);
    if (!st.isFile() || st.size > maxBytes) return undefined;
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      if (buf.includes(0)) return undefined;
      return buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return undefined;
  }
}

/** Bounded store of file contents captured at PreToolUse, keyed by tool_use_id. */
export class SnapshotStore {
  private readonly map = new Map<string, { content: string | null; bytes: number; at: number }>();
  private bytes = 0;

  constructor(private readonly maxTotalBytes = 32 * 1024 * 1024, private readonly ttlMs = 30 * 60 * 1000) {}

  set(toolUseId: string, content: string | null): void {
    this.delete(toolUseId);
    const bytes = content ? content.length : 0;
    this.map.set(toolUseId, { content, bytes, at: Date.now() });
    this.bytes += bytes;
    this.evict();
  }

  /** Remove and return the snapshot. undefined = none captured. */
  take(toolUseId: string): string | null | undefined {
    const e = this.map.get(toolUseId);
    if (!e) return undefined;
    this.delete(toolUseId);
    return e.content;
  }

  delete(toolUseId: string): void {
    const e = this.map.get(toolUseId);
    if (!e) return;
    this.bytes -= e.bytes;
    this.map.delete(toolUseId);
  }

  get size(): number {
    return this.map.size;
  }

  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxTotalBytes && now - v.at < this.ttlMs) break;
      this.delete(k);
    }
  }
}
