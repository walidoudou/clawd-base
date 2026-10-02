import { open, readFile, stat } from 'node:fs/promises';
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

/**
 * Tails Claude Code transcripts (`<projects>/<slug>/<session>.jsonl`, sub-agent
 * files and their `.meta.json`) and emits normalized events. Works without hooks.
 */
export class TranscriptWatcher {
  private watcher: FSWatcher | null = null;
  private readonly files = new Map<string, FileState>();
  private readonly metaSeen = new Map<string, number>();
  private poll: NodeJS.Timeout | null = null;
  private ready = false;

  constructor(
    private readonly projectsDir: string,
    private readonly maxAgeMs: number,
    private readonly emit: (events: NormalizedEvent[]) => void,
    private readonly onError: (msg: string) => void = () => {},
  ) {}

  /** Resolves after the initial scan has been read. */
  async start(): Promise<void> {
    const initial: Promise<void>[] = [];
    this.watcher = watch(this.projectsDir, {
      ignoreInitial: false,
      depth: 4,
      persistent: true,
      ignored: (path, stats) => {
        if (/\/(tool-results|memory|tasks|file-history)(\/|$)/.test(path)) return true;
        if (stats?.isFile()) return !(path.endsWith('.jsonl') || path.endsWith('.meta.json'));
        return false;
      },
    });
    this.watcher.on('add', (path, st) => {
      if (!this.ready) {
        const mtime = st?.mtimeMs ?? 0;
        if (Date.now() - mtime > this.maxAgeMs) return; // dormant: read fully if it changes later
        initial.push(this.handle(path));
      } else this.safeHandle(path);
    });
    this.watcher.on('change', (path) => this.safeHandle(path));
    this.watcher.on('error', (e) => this.onError(`watcher: ${String(e)}`));
    await new Promise<void>((res) => this.watcher?.once('ready', () => res()));
    // Read in a deterministic order: main transcripts first, then meta, then sub-agents.
    await Promise.allSettled(initial);
    this.ready = true;
    // Safety net: some FS events get coalesced; poll recently active files.
    this.poll = setInterval(() => {
      const now = Date.now();
      for (const [path, st] of this.files) if (now - st.lastChangeAt < 10 * 60 * 1000) this.safeHandle(path);
    }, 2000);
  }

  async stop(): Promise<void> {
    if (this.poll) clearInterval(this.poll);
    await this.watcher?.close();
  }

  get trackedFiles(): number {
    return this.files.size;
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
