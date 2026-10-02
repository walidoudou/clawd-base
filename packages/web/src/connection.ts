import type { DashConfig, PatchBatch, Snapshot } from '@dash/shared';
import { applyPatch, applySnapshot, useDash } from './state.ts';

/** Background tabs release their stream after this delay. */
const HIDDEN_CLOSE_MS = 20_000;

/**
 * Connect to the server's SSE stream. EventSource reconnects automatically (Last-Event-ID replay).
 *
 * Browsers allow only 6 HTTP/1.1 connections per host: several dashboard tabs each holding a
 * stream would starve page loads. Hidden tabs therefore close their stream and reopen it
 * (with a fresh snapshot) when they become visible again.
 */
export function connect(): () => void {
  let es: EventSource | null = null;
  let hiddenTimer: number | null = null;

  const open = () => {
    if (es) return;
    const src = new EventSource('/api/stream');
    es = src;
    useDash.getState().setConnection('connecting');
    src.onopen = () => useDash.getState().setConnection('open');
    src.onerror = () => useDash.getState().setConnection(src.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    src.addEventListener('snapshot', (e) => applySnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot));
    src.addEventListener('patch', (e) => applyPatch(JSON.parse((e as MessageEvent<string>).data) as PatchBatch));
  };
  const close = () => {
    es?.close();
    es = null;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenTimer = window.setTimeout(close, HIDDEN_CLOSE_MS);
    } else {
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      hiddenTimer = null;
      open();
    }
  };

  open();
  document.addEventListener('visibilitychange', onVisibility);
  fetch('/api/config')
    .then((r) => r.json() as Promise<DashConfig>)
    .then((c) => useDash.getState().setConfig(c))
    .catch(() => {});
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
    close();
  };
}
