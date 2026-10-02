import { useMemo, useState } from 'react';
import type { FileChange } from '@dash/shared';
import { t } from '../i18n/index.ts';
import { agentLabel, data, sessionFiles, useDash } from '../state.ts';
import { basename, formatTime } from '../format.ts';
import { DiffView } from './DiffView.tsx';

interface FileGroup {
  path: string;
  changes: FileChange[];
  reads: number;
  edits: number;
  added: number;
  removed: number;
  agents: string[];
  lastAt: number;
}

function group(changes: FileChange[]): FileGroup[] {
  const m = new Map<string, FileGroup>();
  for (const c of changes) {
    let g = m.get(c.path);
    if (!g) m.set(c.path, (g = { path: c.path, changes: [], reads: 0, edits: 0, added: 0, removed: 0, agents: [], lastAt: 0 }));
    g.changes.push(c);
    if (c.operation === 'read') g.reads++;
    else {
      g.edits++;
      g.added += c.added;
      g.removed += c.removed;
    }
    if (!g.agents.includes(c.agentId)) g.agents.push(c.agentId);
    g.lastAt = Math.max(g.lastAt, c.at);
  }
  for (const g of m.values()) g.changes.sort((a, b) => a.at - b.at);
  return [...m.values()];
}

/** Common directory prefix so paths can be shown relative to the project. */
function commonDir(paths: string[]): string {
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0] ?? [];
  let n = first.length;
  for (const s of split) {
    let i = 0;
    while (i < n && s[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

function AgentChip({ id }: { id: string }) {
  const select = useDash((s) => s.select);
  const a = data.agents.get(id);
  if (!a) return null;
  return (
    <button className="chip" onClick={() => select({ kind: 'agent', id })}>
      {a.kind === 'main' ? t.mainRoom : agentLabel(a)}
    </button>
  );
}

/** Every file touched in the session, with aggregated counters and diffs. */
export function FilesView() {
  useDash((s) => s.version);
  const sessionId = useDash((s) => s.sessionId);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'recent' | 'lines' | 'name'>('recent');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showReads, setShowReads] = useState(false);
  const groups = useMemo(() => (sessionId ? group(sessionFiles(sessionId)) : []), [sessionId, useDash.getState().version]);
  if (!sessionId) return <div className="empty">{t.noSession}</div>;
  const root = commonDir(groups.map((g) => g.path));
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  const edited = groups.filter((g) => g.edits > 0);
  const readOnly = groups.filter((g) => g.edits === 0);
  const list = (showReads ? groups : edited)
    .filter((g) => !filter || g.path.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (sort === 'recent' ? b.lastAt - a.lastAt : sort === 'lines' ? b.added + b.removed - (a.added + a.removed) : a.path.localeCompare(b.path)));
  const totalAdded = edited.reduce((s, g) => s + g.added, 0);
  const totalRemoved = edited.reduce((s, g) => s + g.removed, 0);
  const toggle = (p: string) => {
    const n = new Set(open);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    setOpen(n);
  };

  return (
    <div className="files-view">
      <header className="files-head">
        <h2 className="section-title">{t.filesTitle}</h2>
        <span className="small">
          {t.filesSummary(edited.length)} · {readOnly.length} {t.readOnly} · <span className="add">+{totalAdded}</span> <span className="del">-{totalRemoved}</span>
        </span>
        <span className="muted small path">{root}</span>
      </header>
      <div className="files-tools">
        <input className="files-filter" placeholder={t.filter} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t.filter} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={t.sort}>
          <option value="recent">{t.sortRecent}</option>
          <option value="lines">{t.sortLines}</option>
          <option value="name">{t.sortName}</option>
        </select>
        <label className="small">
          <input type="checkbox" checked={showReads} onChange={(e) => setShowReads(e.target.checked)} /> {t.showReads}
        </label>
        <button onClick={() => setOpen(new Set(list.map((g) => g.path)))}>{t.expandAll}</button>
        <button onClick={() => setOpen(new Set())}>{t.collapseAll}</button>
      </div>
      <ul className="files-list">
        {list.map((g) => (
          <li key={g.path} className="files-item">
            <button className="file-head" onClick={() => toggle(g.path)} aria-expanded={open.has(g.path)}>
              <span className="file-name">{basename(g.path)}</span>
              <span className="muted small file-rel">{rel(g.path)}</span>
              <span className="small muted">
                {g.edits ? `${g.edits} ${t.op.edit}` : ''} {g.reads ? `${g.reads} ${t.op.read}` : ''}
              </span>
              <span className="small muted">{formatTime(g.lastAt)}</span>
              {g.edits > 0 && (
                <span className="file-counts">
                  <span className="add">+{g.added}</span> <span className="del">-{g.removed}</span>
                </span>
              )}
            </button>
            {open.has(g.path) && (
              <div className="file-diffs">
                <div className="small">
                  {t.byAgents} {g.agents.map((id) => <AgentChip key={id} id={id} />)}
                </div>
                {g.changes
                  .filter((c) => c.operation !== 'read')
                  .map((c) => (
                    <div key={c.id} className="file-change">
                      <div className="small muted">
                        {formatTime(c.at)} · {t.op[c.operation]} · <AgentChip id={c.agentId} /> · <span className="add">+{c.added}</span> <span className="del">-{c.removed}</span>
                      </div>
                      <DiffView change={c} />
                    </div>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
