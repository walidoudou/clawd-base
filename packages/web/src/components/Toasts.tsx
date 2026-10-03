import { useDash } from '../state.ts';
import { t } from '../i18n/index.ts';

const ICON = { info: '◆', success: '✔', warn: '⚠', error: '✖' } as const;

/** Game-style notifications in the top-right corner. */
export function Toasts() {
  const toasts = useDash((s) => s.toasts);
  const dismiss = useDash((s) => s.dismissToast);
  const select = useDash((s) => s.select);
  const selectSession = useDash((s) => s.selectSession);
  // The live region stays mounted (even empty) so screen readers announce the first toast too.
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.level}`}>
          <button
            className="toast-body"
            onClick={() => {
              if (x.switchTo) selectSession(x.switchTo);
              else if (x.agentId) select({ kind: 'agent', id: x.agentId });
              dismiss(x.id);
            }}
          >
            <span className="toast-icon" aria-hidden>
              {ICON[x.level]}
            </span>
            {x.text}
          </button>
          <button className="toast-close" onClick={() => dismiss(x.id)} aria-label={t.close}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
