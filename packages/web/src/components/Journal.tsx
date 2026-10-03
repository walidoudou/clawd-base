import { t } from '../i18n/index.ts';
import { sessionLogs, useDash } from '../state.ts';
import { formatTime } from '../format.ts';

const KIND_ICON: Record<string, string> = {
  prompt: '›',
  'agent.spawn': '+',
  'agent.start': '▸',
  'agent.stop': '■',
  'tool.start': '·',
  'tool.end': '✖',
  'file.change': '✎',
  notification: '♪',
  attention: '?',
  error: '✖',
  compact: '⇣',
  task: '☐',
  'session.start': '◆',
  'session.end': '◇',
};

/** Live event feed ("journal de bord") for the session on screen. */
export function Journal() {
  useDash((s) => s.version);
  const sessionId = useDash((s) => s.sessionId);
  const open = useDash((s) => s.journalOpen);
  const setOpen = useDash((s) => s.setJournalOpen);
  const select = useDash((s) => s.select);
  const logs = sessionId ? sessionLogs(sessionId, 120) : [];
  return (
    <section className={`journal ${open ? 'open' : ''}`} aria-label={t.journal}>
      <button className="journal-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} {t.journal}
        {!open && logs[0] ? (
          <span className="journal-last">
            {' '}
            — {t.labelled(t.logKind[logs[0].kind] ?? logs[0].kind, logs[0].summary)}
          </span>
        ) : null}
      </button>
      {open && (
        <ol className="journal-list">
          {logs.length === 0 && <li className="muted small">{t.noEvents}</li>}
          {logs.map((l) => (
            <li key={l.seq} className={`jl jl-${l.level}`}>
              <button className="jl-btn" disabled={!l.agentId} onClick={() => l.agentId && select({ kind: 'agent', id: l.agentId })}>
                <span className="jl-time">{formatTime(l.at)}</span>
                <span className="jl-icon" aria-hidden>
                  {KIND_ICON[l.kind] ?? '·'}
                </span>
                <span className="jl-kind">{t.logKind[l.kind] ?? l.kind}</span>
                <span className="jl-text">{l.summary}</span>
                <span className="jl-src">{l.source === 'hook' ? 'H' : l.source === 'transcript' ? 'T' : 'S'}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
