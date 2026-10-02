import type { TokenUsage } from '@dash/shared';
import { t, intlLocale } from '../i18n/index.ts';
import { formatTokens } from '../format.ts';

const ROWS: Array<{ key: keyof TokenUsage; label: string; cls: string }> = [
  { key: 'input', label: t.tokIn, cls: 'tk-in' },
  { key: 'output', label: t.tokOut, cls: 'tk-out' },
  { key: 'cacheCreate', label: t.tokCacheCreate, cls: 'tk-cc' },
  { key: 'cacheRead', label: t.tokCacheRead, cls: 'tk-cr' },
];

export function TokenBreakdown({ usage }: { usage: TokenUsage }) {
  const total = usage.total || 1;
  return (
    <div className="tokens">
      <div className="tk-bar" aria-hidden>
        {ROWS.map((r) => (
          <span key={r.key} className={r.cls} style={{ width: `${(usage[r.key] / total) * 100}%` }} />
        ))}
      </div>
      <table className="tk-table">
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <td><span className={`tk-dot ${r.cls}`} /> {r.label}</td>
              <td className="num" title={usage[r.key].toLocaleString(intlLocale)}>{formatTokens(usage[r.key])}</td>
            </tr>
          ))}
          <tr className="tk-total">
            <td>{t.tokTotal}</td>
            <td className="num" title={usage.total.toLocaleString(intlLocale)}>{formatTokens(usage.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function TokenChips({ usage }: { usage: TokenUsage }) {
  return (
    <span className="tk-chips">
      <span className="tk-chip tk-in" title={t.tokIn}>↓{formatTokens(usage.input)}</span>
      <span className="tk-chip tk-out" title={t.tokOut}>↑{formatTokens(usage.output)}</span>
      <span className="tk-chip tk-cr" title={`${t.tokCacheCreate} + ${t.tokCacheRead}`}>⛁{formatTokens(usage.cacheCreate + usage.cacheRead)}</span>
      <span className="tk-chip tk-tot" title={t.tokTotal}>Σ{formatTokens(usage.total)}</span>
    </span>
  );
}
