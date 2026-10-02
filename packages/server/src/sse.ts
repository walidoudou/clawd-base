import type { ServerResponse } from 'node:http';
import { LIMITS, type PatchBatch, type StateStore } from '@dash/shared';

/** Replay ring is bounded by bytes as well as by count. */
const RING_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Server-Sent Events hub. Changes are coalesced by the store and flushed at a
 * fixed rate (render throttling happens server-side first). Clients that
 * reconnect with Last-Event-ID get the missed batches, or a full snapshot.
 */
export class SseHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly ring: Array<{ seq: number; payload: string }> = [];
  private ringBytes = 0;
  /**
   * Event ids are `<epoch>-<seq>`: after a server restart the epoch differs, so a reconnecting
   * client gets a fresh snapshot instead of replaying another instance's sequence numbers.
   */
  private readonly epoch = Date.now().toString(36);
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly store: StateStore, private readonly intervalMs = 100) {}

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.intervalMs);
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.write(': ping\n\n');
    }, 15000);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  /** Id a client would send to resume right now (tests, diagnostics). */
  get lastEventId(): string {
    return `${this.epoch}-${this.store.seq}`;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  flush(): PatchBatch | null {
    const batch = this.store.flush();
    if (!batch) return null;
    const payload = `id: ${this.epoch}-${batch.seq}\nevent: patch\ndata: ${JSON.stringify(batch)}\n\n`;
    this.ring.push({ seq: batch.seq, payload });
    this.ringBytes += payload.length;
    while (this.ring.length > LIMITS.replayRing || (this.ringBytes > RING_MAX_BYTES && this.ring.length > 1)) {
      const old = this.ring.shift();
      if (old) this.ringBytes -= old.payload.length;
    }
    for (const c of this.clients) c.write(payload);
    return batch;
  }

  attach(res: ServerResponse, lastEventId: string | undefined): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    // Make sure pending changes are in the ring before deciding what to replay.
    this.flush();
    const m = lastEventId ? /^([0-9a-z]+)-(\d+)$/.exec(lastEventId) : null;
    const last = m && m[1] === this.epoch ? Number(m[2]) : NaN;
    const first = this.ring[0];
    if (Number.isFinite(last) && first && last >= first.seq - 1 && last <= this.store.seq) {
      for (const b of this.ring) if (b.seq > last) res.write(b.payload);
    } else {
      const snap = this.store.snapshot();
      res.write(`id: ${this.epoch}-${snap.seq}\nevent: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    }
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }
}
