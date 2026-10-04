import type { Dirent, Stats } from 'node:fs';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { watch, type FSWatcher } from 'chokidar';
import { TranscriptParser, eventsFromAgentMeta, identifyTranscript, type NormalizedEvent } from '@dash/shared';

interface FileState {
  offset: number;
  partial: string;
  /** Keeps multi-byte UTF-8 characters intact across read boundaries. */
  decoder: StringDecoder;
  parser: TranscriptParser;
  reading: Promise<void> | null;
  again: boolean;
  lastChangeAt: number;
}

const CHUNK = 1024 * 1024;
/** Directory levels below projectsDir (chokidar `depth`, and the rescan). */
const DEPTH = 5;
/** Claude Code keeps more than transcripts there; tested on the path relative to projectsDir. */
const SKIPPED_DIRS = /(^|\/)(tool-results|memory|tasks|file-history)(\/|$)/;

export interface WatcherOptions {
  /** Poll interval while projectsDir does not exist yet. */
  missingPollMs?: number;
  /** Interval of the rescan that adopts dormant transcripts once they change again. */
  rescanMs?: number;
  /** Files read in parallel (initial load, rescan). */
  concurrency?: number;
}

const isTranscriptName = (p: string): boolean => p.endsWith('.jsonl') || p.endsWith('.meta.json');

/** Read order: main transcripts, then meta files, then sub-agent transcripts. */
const KIND_ORDER = { main: 0, meta: 1, subagent: 2 } as const;

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Tails Claude Code transcripts (`<projects>/<slug>/<session>.jsonl`, sub-agent
 * files and their `.meta.json`) and emits normalized events. Works without hooks.
 *
 * Transcripts last modified more than maxAgeMs before startup are dormant: not read and not watched
 * (chokidar holds one fd / inotify watch per file, and old sessions pile up by the thousand). A periodic
 * rescan adopts one as soon as it is modified again (a resumed session).
 */
export class TranscriptWatcher {
  private watcher: FSWatcher | null = null;
  private readonly files = new Map<string, FileState>();
  private readonly metaSeen = new Map<string, number>();
  private poll: NodeJS.Timeout | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private waitTimer: NodeJS.Timeout | null = null;
  /** Resolves a pending wait for chokidar's 'ready' when stop() comes first. */
  private wake: (() => void) | null = null;
  private ready = false;
  private stopped = false;
  private rescanning = false;
  /** startup − maxAgeMs: files last modified before this are dormant. */
  private dormantBefore = 0;
  private readonly opts: Required<WatcherOptions>;

  constructor(
    private readonly projectsDir: string,
    private readonly maxAgeMs: number,
    private readonly emit: (events: NormalizedEvent[]) => void,
    private readonly onError: (msg: string) => void = () => {},
    opts: WatcherOptions = {},
  ) {
    this.opts = { missingPollMs: 3000, rescanMs: 15_000, concurrency: 8, ...opts };
  }

  /** Resolves after the initial scan has been read, or at once if projectsDir does not exist yet. */
  async start(): Promise<void> {
    this.dormantBefore = Date.now() - this.maxAgeMs;
    if (await isDir(this.projectsDir)) return this.watch();
    // Started before the first Claude Code session, or a CLAUDE_CONFIG_DIR fixed later: wait for it.
    this.onError(`${this.projectsDir} introuvable — en attente de sa création`);
    this.waitTimer = setInterval(() => {
      void isDir(this.projectsDir).then((ok) => {
        if (!ok || !this.waitTimer) return;
        clearInterval(this.waitTimer);
        this.waitTimer = null;
        this.watch().catch((e: unknown) => this.onError(`watcher: ${String(e)}`));
      });
    }, this.opts.missingPollMs);
  }

  private async watch(): Promise<void> {
    if (this.stopped) return;
    const initial = new Set<string>();
    let collecting = true;
    const watcher = watch(this.projectsDir, {
      ignoreInitial: false,
      depth: DEPTH,
      persistent: true,
      ignored: (path, stats) => this.skip(path, stats),
    });
    this.watcher = watcher;
    watcher.on('add', (path, st) => {
      if (!collecting) return this.safeHandle(path);
      if ((st?.mtimeMs ?? 0) < this.dormantBefore) return; // dormant (normally already skipped)
      initial.add(path);
    });
    // During the initial load the ordered read below reaches EOF anyway (and the poll catches up).
    watcher.on('change', (path) => {
      if (this.ready || !initial.has(path)) this.safeHandle(path);
    });
    watcher.on('error', (e) => this.onError(`watcher: ${String(e)}`));
    await new Promise<void>((res) => {
      this.wake = res;
      watcher.once('ready', () => res());
    });
    this.wake = null;
    collecting = false;
    if (this.stopped) return;
    await this.load([...initial]);
    this.ready = true;
    initial.clear();
    if (this.stopped) return;
    // Safety net: some FS events get coalesced; poll recently active files.
    this.poll = setInterval(() => {
      const now = Date.now();
      for (const [path, st] of this.files) if (now - st.lastChangeAt < 10 * 60 * 1000) this.safeHandle(path);
    }, 2000);
    this.rescanTimer = setInterval(() => void this.rescan(), this.opts.rescanMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    if (this.waitTimer) clearInterval(this.waitTimer);
    this.waitTimer = null;
    if (this.poll) clearInterval(this.poll);
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    await this.watcher?.close();
  }

  /**
   * Adopt transcripts that are neither tracked nor dormant any more: a dormant file modified again
   * (resumed session), or a new file whose `add` event was missed. Sequential readdir, a few stats at a
   * time, nothing kept between runs: cheap even with thousands of files. Runs every `rescanMs`.
   */
  async rescan(): Promise<void> {
    if (this.rescanning || this.stopped) return;
    this.rescanning = true;
    try {
      const found: string[] = [];
      const walk = async (dir: string, level: number): Promise<void> => {
        let entries: Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        const candidates: string[] = [];
        for (const e of entries) {
          const path = join(dir, e.name);
          if (e.isDirectory()) {
            if (level < DEPTH && !SKIPPED_DIRS.test(this.rel(path))) await walk(path, level + 1);
          } else if (e.isFile() && isTranscriptName(e.name) && !this.files.has(path) && !this.metaSeen.has(path) && identifyTranscript(path)) {
            candidates.push(path);
          }
        }
        await pool(candidates, this.opts.concurrency, async (path) => {
          const st = await stat(path).catch(() => null);
          if (st && st.mtimeMs >= this.dormantBefore) found.push(path);
        });
      };
      await walk(this.projectsDir, 0);
      if (this.stopped || !found.length) return;
      await this.load(found);
      // From now on chokidar watches it like any recent file (skip() no longer excludes it).
      // Not after stop(): chokidar's add() would reopen a closed watcher.
      if (!this.stopped) for (const path of found) this.watcher?.add(path);
    } finally {
      this.rescanning = false;
    }
  }

  get trackedFiles(): number {
    return this.files.size;
  }

  /** projectsDir-relative path with '/' separators (a projects dir under e.g. /x/tasks/ must still work). */
  private rel(path: string): string {
    return relative(this.projectsDir, path).replace(/\\/g, '/');
  }

  /**
   * chokidar `ignored`: other sub-trees, non-transcript files, and dormant transcripts. Monotonic for a
   * given file (mtime only grows): once modified after startup − maxAge it is never skipped again, so
   * chokidar never drops a file it already watches.
   */
  private skip(path: string, stats?: Stats): boolean {
    if (SKIPPED_DIRS.test(this.rel(path))) return true;
    if (!stats?.isFile()) return false;
    if (!isTranscriptName(path)) return true;
    return stats.mtimeMs < this.dormantBefore;
  }

  /**
   * Read files in a deterministic order: main transcripts first, then meta, then sub-agents (the
   * reducer must know the Agent call before the meta that links a sub-agent to it). Each kind is
   * finished before the next starts; a few reads at a time to spare file descriptors.
   */
  private async load(paths: string[]): Promise<void> {
    const groups: string[][] = [[], [], []];
    for (const path of paths.sort()) {
      const id = identifyTranscript(path);
      if (id) groups[KIND_ORDER[id.kind]]?.push(path);
    }
    for (const group of groups) {
      await pool(group, this.opts.concurrency, (path) => this.handle(path).catch((e: unknown) => this.onError(`watch ${path}: ${String(e)}`)));
    }
  }

  /** Fire-and-forget wrapper: a failing file must never produce an unhandled rejection. */
  private safeHandle(path: string): void {
    this.handle(path).catch((e: unknown) => this.onError(`watch ${path}: ${String(e)}`));
  }

  private async handle(path: string): Promise<void> {
    const id = identifyTranscript(path);
    if (!id) return;
    if (id.kind === 'meta') return this.handleMeta(path, id.sessionId, id.agentId as string);
    let st = this.files.get(path);
    if (!st) {
      st = {
        offset: 0,
        partial: '',
        decoder: new StringDecoder('utf8'),
        parser: new TranscriptParser({ sessionId: id.sessionId, agentId: id.agentId, path }),
        reading: null,
        again: false,
        lastChangeAt: Date.now(),
      };
      this.files.set(path, st);
    }
    if (st.reading) {
      st.again = true;
      return st.reading;
    }
    const state = st;
    state.reading = (async () => {
      try {
        do {
          state.again = false;
          await this.readNew(path, state);
        } while (state.again);
      } catch (e) {
        // File vanished, EMFILE, a bad event… keep tailing next time instead of wedging this file.
        this.onError(`read ${path}: ${String(e)}`);
      } finally {
        state.reading = null;
      }
    })();
    return state.reading;
  }

  private async readNew(path: string, st: FileState): Promise<void> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return;
    }
    if (size < st.offset) {
      // Truncated/rewritten: start over.
      st.offset = 0;
      st.partial = '';
      st.decoder = new StringDecoder('utf8');
    }
    if (size === st.offset) return;
    st.lastChangeAt = Date.now();
    const fh = await open(path, 'r');
    try {
      while (st.offset < size) {
        const len = Math.min(CHUNK, size - st.offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, st.offset);
        if (bytesRead <= 0) break;
        st.offset += bytesRead;
        const text = st.partial + st.decoder.write(buf.subarray(0, bytesRead));
        const lines = text.split('\n');
        st.partial = lines.pop() ?? '';
        const events: NormalizedEvent[] = [];
        for (const line of lines) {
          try {
            events.push(...st.parser.parseLine(line));
          } catch (e) {
            this.onError(`parse ${path}: ${String(e)}`);
          }
        }
        if (events.length) {
          try {
            this.emit(events);
          } catch (e) {
            this.onError(`apply ${path}: ${String(e)}`);
          }
        }
      }
    } finally {
      await fh.close();
    }
  }

  private async handleMeta(path: string, sessionId: string, agentId: string): Promise<void> {
    try {
      const st = await stat(path);
      if (this.metaSeen.get(path) === st.mtimeMs) return;
      this.metaSeen.set(path, st.mtimeMs);
      const meta: unknown = JSON.parse(await readFile(path, 'utf8'));
      this.emit(eventsFromAgentMeta(sessionId, agentId, meta, st.birthtimeMs || st.mtimeMs));
    } catch (e) {
      this.onError(`meta ${path}: ${String(e)}`);
    }
  }
}
