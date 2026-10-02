import { memo, useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import { rangesLabel, type FileChange } from '@dash/shared';
import { t } from '../i18n/index.ts';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'css', html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  sh: 'bash', zsh: 'bash', bash: 'bash', py: 'python', md: 'markdown', yml: 'yaml', yaml: 'yaml', rs: 'rust', go: 'go',
};

function langOf(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? null;
}

function highlight(code: string, lang: string | null): string {
  if (!lang) return code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  }
}

export const DiffView = memo(function DiffView({ change }: { change: FileChange }) {
  const lang = langOf(change.path);
  const rows = useMemo(() => {
    const out: Array<{ key: string; kind: 'add' | 'del' | 'ctx' | 'sep'; oldNo: string; newNo: string; html: string }> = [];
    change.hunks.forEach((h, hi) => {
      if (hi > 0) out.push({ key: `s${hi}`, kind: 'sep', oldNo: '', newNo: '', html: '⋯' });
      let o = h.oldStart;
      let n = h.newStart;
      const known = h.newStart > 0;
      h.lines.forEach((line, li) => {
        const sign = line.charAt(0);
        const body = line.slice(1);
        const html = highlight(body, lang);
        if (sign === '+') {
          out.push({ key: `${hi}-${li}`, kind: 'add', oldNo: '', newNo: known ? String(n) : '', html });
          n++;
        } else if (sign === '-') {
          out.push({ key: `${hi}-${li}`, kind: 'del', oldNo: known ? String(o) : '', newNo: '', html });
          o++;
        } else {
          out.push({ key: `${hi}-${li}`, kind: 'ctx', oldNo: known ? String(o) : '', newNo: known ? String(n) : '', html });
          o++;
          n++;
        }
      });
    });
    return out;
  }, [change, lang]);

  if (!change.hunks.length) return <div className="muted small">{t.noDiff}</div>;
  const ranges = rangesLabel(change.hunks);
  return (
    <div className="diff">
      <div className="diff-meta small muted">
        {ranges || t.unknownLines} · {t.diffSource[change.diffSource]}
        {change.truncated ? ` · ${t.truncated}` : ''}
      </div>
      <table className="diff-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`dl dl-${r.kind}`}>
              <td className="ln">{r.oldNo}</td>
              <td className="ln">{r.newNo}</td>
              <td className="sg">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : r.kind === 'sep' ? '' : ' '}</td>
              <td className="code hljs" dangerouslySetInnerHTML={{ __html: r.html || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
