import { intlLocale } from './i18n/index.ts';
import { formatTokens } from '@dash/shared';

export { formatTokens };

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}`;
  return `${sec}s`;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(intlLocale, { hour12: false });
}

export function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

/** Short model badge: "claude-opus-5-5" → "Opus 5.5". */
export function modelBadge(model: string | null): string {
  if (!model) return '?';
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model);
  if (!m) return model.slice(0, 12);
  const name = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1);
  const minor = m[3] && m[3].length <= 2 ? `.${m[3]}` : '';
  return `${name} ${m[2]}${minor}`;
}

export function preview(text: string, n = 100): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
