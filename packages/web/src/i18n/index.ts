import { fr, type Strings } from './fr.ts';
import { en } from './en.ts';

export type Locale = 'fr' | 'en';
export type { Strings };

/** Locale: ?lang= in the URL, then the saved choice (localStorage), then the browser language. */
export function currentLocale(): Locale {
  // ?lang=en / ?lang=fr in the URL wins (handy for sharing a link).
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (q === 'fr' || q === 'en') return q;
  try {
    const saved = localStorage.getItem('dash.locale');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return lang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLocale(l: Locale): void {
  try {
    localStorage.setItem('dash.locale', l);
  } catch {
    /* ignore */
  }
  // ?lang= in the URL would win over the saved choice: drop it.
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}

export const locale: Locale = currentLocale();
export const t: Strings = locale === 'fr' ? fr : en;
/** BCP-47 tag for dates and numbers. */
export const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-US';
if (typeof document !== 'undefined') document.documentElement.lang = locale;
