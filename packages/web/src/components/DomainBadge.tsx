import type { Domain, DomainReason } from '@dash/shared';
import { t } from '../i18n/index.ts';

export const DOMAIN_ICON: Record<Domain, string> = { code: '⌨️', game: '🎮', marketing: '📣', business: '💼', video: '🎬', design: '🎨', audio: '🎧', bot: '🤖', data: '📊', devops: '🛠️', security: '🛡️', web: '🌐' };

/** The field a room works in, and (in panels) the clues that decided it. */
export function DomainBadge({ domain, reasons }: { domain: Domain; reasons?: DomainReason[] }) {
  const why = reasons?.length ? reasons.map((r) => `${t.reasonKind[r.kind] ?? r.kind} ${r.kind === 'prior' ? '' : r.value}`.trim()).join(' · ') : domain === 'code' ? t.domainDefault : '';
  return (
    <span className={`badge domain domain-${domain}`} title={`${t.domainTitle}${why ? ` — ${why}` : ''}`}>
      {DOMAIN_ICON[domain]} {t.domainName[domain] ?? domain}
    </span>
  );
}
