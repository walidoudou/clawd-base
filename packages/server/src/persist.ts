import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedEvent } from '@dash/shared';

type Statement = { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; iterate(...args: unknown[]): Iterable<unknown> };
type Db = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

const RETENTION_MS = 7 * 24 * 3600 * 1000;

/**
 * Optional persistence of hook-derived events (transcripts are already on disk).
 * Uses Node's built-in `node:sqlite` (no native dependency). If unavailable, it is a no-op.
 */
export class EventLog {
  private db: Db | null = null;
  private insert: ReturnType<Db['prepare']> | null = null;
  private queue: NormalizedEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  static async open(dataDir: string, onError: (m: string) => void): Promise<EventLog> {
    const log = new EventLog();
    try {
      mkdirSync(dataDir, { recursive: true });
      const mod = (await import('node:sqlite')) as unknown as { DatabaseSync: new (path: string) => Db };
      const db = new mod.DatabaseSync(join(dataDir, 'events.db'));
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL)');
      db.exec('CREATE INDEX IF NOT EXISTS events_at ON events(at)');
      log.db = db;
      log.purge();
      log.insert = db.prepare('INSERT INTO events (session_id, at, json) VALUES (?, ?, ?)');
    } catch (e) {
      onError(`persistance désactivée: ${String(e)}`);
    }
    return log;
  }

  get enabled(): boolean {
    return this.db !== null;
  }

  append(events: NormalizedEvent[]): void {
    if (!this.db) return;
    this.queue.push(...events);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    this.timer = null;
    if (!this.db || !this.insert || !this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.db.exec('BEGIN');
    try {
      for (const e of batch) this.insert.run(e.sessionId, Math.round(e.at), JSON.stringify(e));
      this.db.exec('COMMIT');
    } catch {
      this.db.exec('ROLLBACK');
    }
  }

  /** Delete events older than the retention window (run at startup and periodically). */
  purge(): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM events WHERE at < ?').run(Date.now() - RETENTION_MS);
    } catch {
      /* ignore */
    }
  }

  /** Stream events newer than `sinceMs` without loading every row in memory. */
  forEachSince(sinceMs: number, cb: (e: NormalizedEvent) => void): number {
    if (!this.db) return 0;
    let n = 0;
    for (const row of this.db.prepare('SELECT json FROM events WHERE at >= ? ORDER BY id').iterate(sinceMs)) {
      try {
        cb(JSON.parse((row as { json: string }).json) as NormalizedEvent);
        n++;
      } catch {
        // skip corrupt row
      }
    }
    return n;
  }

  loadSince(sinceMs: number): NormalizedEvent[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT json FROM events WHERE at >= ? ORDER BY id').all(sinceMs) as Array<{ json: string }>;
    const out: NormalizedEvent[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.json) as NormalizedEvent);
      } catch {
        // skip corrupt row
      }
    }
    return out;
  }

  close(): void {
    this.flush();
    this.db?.close();
    this.db = null;
  }
}
