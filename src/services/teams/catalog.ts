import { normalizePersian, type Lang } from '../../i18n/index.js';
import { normalizeName } from '../../utils/text.js';

/**
 * Team localization catalog (configuration layer).
 *
 * Rules:
 *  - A provider team name is mapped to an entry ONLY by exact normalized equality with one of the
 *    entry's English names/aliases. No substring or fuzzy matching, so "Esteghlal" never
 *    resolves to "Esteghlal Khuzestan" (they are separate entries).
 *  - If two entries ever claim the same normalized alias the alias is discarded (ambiguous) — see
 *    `AMBIGUOUS_ALIASES`; a unit test asserts there are none in the shipped data.
 *  - Unknown teams are never translated: the provider's own name is shown in both languages.
 *  - `providerIds` is for verified provider-specific IDs. It is empty until verified against a live key.
 *
 * Persian names for Iranian clubs follow the spellings used on Iranian football sites
 * (e.g. the league table on soot360.com, checked 2026-11-06). English aliases are the spellings
 * commonly used by international data providers; they are matched exactly, never guessed.
 */
export interface TeamEntry {
  id: string;
  fa: string;
  en: string;
  /** Extra English spellings used by providers */
  aliasesEn?: string[];
  /** Extra Persian spellings (colloquial / abbreviations) */
  aliasesFa?: string[];
  country: 'IR' | 'WORLD';
  providerIds?: Partial<Record<'victoryapi' | 'footballdata', number>>;
}

export const TEAM_CATALOG: TeamEntry[] = [
  // ── Iran (Persian Gulf Pro League 2026-27 clubs seen on public league tables)
  { id: 'esteghlal', fa: 'استقلال', en: 'Esteghlal', aliasesEn: ['Esteghlal FC', 'Esteghlal Tehran', 'Esteghlal F.C.'], country: 'IR' },
  { id: 'persepolis', fa: 'پرسپولیس', en: 'Persepolis', aliasesEn: ['Persepolis FC', 'Persepolis Tehran', 'Persepolis F.C.'], country: 'IR' },
  { id: 'sepahan', fa: 'سپاهان', en: 'Sepahan', aliasesEn: ['Sepahan SC', 'Sepahan Isfahan', 'Sepahan Esfahan'], country: 'IR' },
  { id: 'tractor', fa: 'تراکتور', en: 'Tractor', aliasesEn: ['Tractor SC', 'Tractor Sazi', 'Tractor Tabriz'], aliasesFa: ['تراکتورسازی'], country: 'IR' },
  { id: 'chadormalou', fa: 'چادرملو اردکان', en: 'Chadormalou', aliasesEn: ['Chadormalou SC', 'Chadormalu', 'Chadormalu Ardakan', 'Chadormalou Ardakan'], aliasesFa: ['چادرملو'], country: 'IR' },
  { id: 'foolad', fa: 'فولاد', en: 'Foolad', aliasesEn: ['Foolad FC', 'Foolad Khuzestan', 'Foolad Khouzestan'], aliasesFa: ['فولاد خوزستان'], country: 'IR' },
  { id: 'esteghlal-khuzestan', fa: 'استقلال خوزستان', en: 'Esteghlal Khuzestan', aliasesEn: ['Esteghlal Khouzestan', 'Esteghlal Khuzestan FC'], country: 'IR' },
  { id: 'aluminium-arak', fa: 'آلومینیوم اراک', en: 'Aluminium Arak', aliasesEn: ['Aluminium Arak FC', 'Alumineh Arak'], country: 'IR' },
  { id: 'mes-shahr-babak', fa: 'مس شهر بابک', en: 'Mes Shahr Babak', aliasesEn: ['Mes Shahr-e Babak', 'Mes Shahrbabak'], aliasesFa: ['مس شهربابک'], country: 'IR' },
  { id: 'fajr-sepasi', fa: 'فجر سپاسی', en: 'Fajr Sepasi', aliasesEn: ['Fajr Sepasi Shiraz', 'Fajr Sepasi SC'], country: 'IR' },
  { id: 'malavan', fa: 'ملوان', en: 'Malavan', aliasesEn: ['Malavan Bandar Anzali', 'Malavan FC'], country: 'IR' },
  { id: 'nassaji', fa: 'نساجی مازندران', en: 'Nassaji Mazandaran', aliasesEn: ['Nassaji Mazandaran FC', 'Nassaji Ghaemshahr'], country: 'IR' },
  { id: 'paykan', fa: 'پیکان', en: 'Paykan', aliasesEn: ['Paykan FC', 'Paykan Tehran'], country: 'IR' },
  { id: 'gol-gohar', fa: 'گل گهر', en: 'Gol Gohar', aliasesEn: ['Gol Gohar Sirjan', 'Gol Gohar SC'], aliasesFa: ['گل‌گهر', 'گل گهر سیرجان'], country: 'IR' },
  { id: 'zob-ahan', fa: 'ذوب آهن', en: 'Zob Ahan', aliasesEn: ['Zob Ahan Isfahan', 'Zob Ahan FC', 'Zobahan'], aliasesFa: ['ذوب‌آهن'], country: 'IR' },
  { id: 'shams-azar', fa: 'شمس آذر قزوین', en: 'Shams Azar', aliasesEn: ['Shams Azar Qazvin', 'Shams Azar FC'], aliasesFa: ['شمس آذر'], country: 'IR' },
  { id: 'sanat-naft', fa: 'صنعت نفت آبادان', en: 'Sanat Naft', aliasesEn: ['Sanat Naft Abadan', 'Sanat Naft FC'], aliasesFa: ['صنعت نفت'], country: 'IR' },
  { id: 'khaybar', fa: 'خیبر خرم آباد', en: 'Khaybar', aliasesEn: ['Khaybar Khorramabad', 'Khyber Khorramabad'], aliasesFa: ['خیبر'], country: 'IR' },

  // ── World (display names only; commonly used Persian spellings)
  { id: 'real-madrid', fa: 'رئال مادرید', en: 'Real Madrid', aliasesEn: ['Real Madrid CF'], country: 'WORLD' },
  { id: 'barcelona', fa: 'بارسلونا', en: 'Barcelona', aliasesEn: ['FC Barcelona'], country: 'WORLD' },
  { id: 'atletico-madrid', fa: 'اتلتیکو مادرید', en: 'Atletico Madrid', aliasesEn: ['Club Atletico de Madrid', 'Atlético Madrid', 'Atletico de Madrid'], country: 'WORLD' },
  { id: 'arsenal', fa: 'آرسنال', en: 'Arsenal', aliasesEn: ['Arsenal FC'], country: 'WORLD' },
  { id: 'chelsea', fa: 'چلسی', en: 'Chelsea', aliasesEn: ['Chelsea FC'], country: 'WORLD' },
  { id: 'liverpool', fa: 'لیورپول', en: 'Liverpool', aliasesEn: ['Liverpool FC'], country: 'WORLD' },
  { id: 'man-united', fa: 'منچستر یونایتد', en: 'Manchester United', aliasesEn: ['Manchester United FC', 'Man United'], country: 'WORLD' },
  { id: 'man-city', fa: 'منچستر سیتی', en: 'Manchester City', aliasesEn: ['Manchester City FC', 'Man City'], country: 'WORLD' },
  { id: 'tottenham', fa: 'تاتنهام', en: 'Tottenham Hotspur', aliasesEn: ['Tottenham Hotspur FC', 'Tottenham'], country: 'WORLD' },
  { id: 'bayern', fa: 'بایرن مونیخ', en: 'Bayern Munich', aliasesEn: ['FC Bayern München', 'FC Bayern Munchen', 'Bayern München', 'FC Bayern Munich'], aliasesFa: ['بایرن'], country: 'WORLD' },
  { id: 'dortmund', fa: 'بوروسیا دورتموند', en: 'Borussia Dortmund', aliasesEn: ['BV Borussia 09 Dortmund', 'Dortmund'], aliasesFa: ['دورتموند'], country: 'WORLD' },
  { id: 'juventus', fa: 'یوونتوس', en: 'Juventus', aliasesEn: ['Juventus FC'], country: 'WORLD' },
  { id: 'ac-milan', fa: 'میلان', en: 'AC Milan', aliasesEn: ['Milan'], aliasesFa: ['آث میلان'], country: 'WORLD' },
  { id: 'inter', fa: 'اینتر', en: 'Inter Milan', aliasesEn: ['FC Internazionale Milano', 'Internazionale', 'Inter'], aliasesFa: ['اینترمیلان'], country: 'WORLD' },
  { id: 'napoli', fa: 'ناپولی', en: 'Napoli', aliasesEn: ['SSC Napoli'], country: 'WORLD' },
  { id: 'psg', fa: 'پاری‌سن‌ژرمن', en: 'Paris Saint-Germain', aliasesEn: ['Paris Saint-Germain FC', 'Paris SG', 'PSG'], aliasesFa: ['پاری سن ژرمن', 'پی اس جی'], country: 'WORLD' },
];

const byAlias = new Map<string, TeamEntry>();
export const AMBIGUOUS_ALIASES = new Set<string>();

for (const e of TEAM_CATALOG) {
  for (const raw of [e.en, ...(e.aliasesEn ?? [])]) {
    const k = normalizeName(raw);
    if (!k) continue;
    const prev = byAlias.get(k);
    if (prev && prev.id !== e.id) AMBIGUOUS_ALIASES.add(k);
    else byAlias.set(k, e);
  }
}
for (const k of AMBIGUOUS_ALIASES) byAlias.delete(k);

export function teamById(id: string): TeamEntry | undefined {
  return TEAM_CATALOG.find((e) => e.id === id);
}

/** Exact-normalized lookup of a provider-supplied team name. */
export function lookupTeam(providerName: string): TeamEntry | null {
  return byAlias.get(normalizeName(providerName)) ?? null;
}

/** Team name shown to a user: Persian name for fa when the catalog is certain, else the provider name. */
export function localizeTeamName(providerName: string, lang: Lang): string {
  const e = lookupTeam(providerName);
  if (!e) return providerName;
  return lang === 'fa' ? e.fa : e.en;
}

/** Stable key independent of provider IDs, used for favorites of catalog teams. */
export function catalogKey(entry: TeamEntry): string {
  return `tc:${entry.id}`;
}

export function displayNameForKey(key: string, fallback: string, lang: Lang): string {
  if (key.startsWith('tc:')) {
    const e = teamById(key.slice(3));
    if (e) return lang === 'fa' ? e.fa : e.en;
  }
  return localizeTeamName(fallback, lang);
}

/** True if the query (Persian or English) matches the team. Substring match on names the team is known by. */
export function teamMatchesQuery(providerName: string, query: string): boolean {
  const qLatin = normalizeName(query);
  const qFa = normalizePersian(query).toLowerCase();
  if (!qLatin && !qFa) return false;
  const haystacks: string[] = [normalizeName(providerName)];
  const e = lookupTeam(providerName);
  const faNames: string[] = [];
  if (e) {
    haystacks.push(normalizeName(e.en), ...(e.aliasesEn ?? []).map(normalizeName));
    faNames.push(normalizePersian(e.fa), ...(e.aliasesFa ?? []).map(normalizePersian));
  }
  if (qLatin && haystacks.some((h) => h.includes(qLatin))) return true;
  return !!qFa && faNames.some((n) => n.includes(qFa));
}
