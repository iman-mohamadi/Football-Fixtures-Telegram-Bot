export type CompetitionCategory = 'england' | 'spain' | 'italy' | 'germany' | 'france' | 'europe' | 'iran' | 'asia' | 'international' | 'other';

export interface CompetitionMeta {
  code: string;
  nameEn: string;
  nameFa: string;
  category: CompetitionCategory;
  aliases?: string[];
}

/**
 * Display metadata only. Whether a competition is *available* is decided by the
 * configured providers (`FixtureService.supportedCompetitions()`), never by this list.
 */
export const COMPETITION_CATALOG: CompetitionMeta[] = [
  { code: 'PL', nameEn: 'Premier League', nameFa: 'لیگ برتر انگلیس', category: 'england', aliases: ['epl', 'english premier league'] },
  { code: 'ELC', nameEn: 'Championship', nameFa: 'چمپیونشیپ انگلیس', category: 'england' },
  { code: 'PD', nameEn: 'La Liga', nameFa: 'لالیگا', category: 'spain', aliases: ['primera division'] },
  { code: 'SA', nameEn: 'Serie A', nameFa: 'سری آ ایتالیا', category: 'italy' },
  { code: 'BL1', nameEn: 'Bundesliga', nameFa: 'بوندسلیگا', category: 'germany' },
  { code: 'BL2', nameEn: '2. Bundesliga', nameFa: 'بوندسلیگا ۲', category: 'germany' },
  { code: 'DFB', nameEn: 'DFB-Pokal', nameFa: 'جام حذفی آلمان', category: 'germany', aliases: ['dfb pokal'] },
  { code: 'FL1', nameEn: 'Ligue 1', nameFa: 'لیگ ۱ فرانسه', category: 'france' },
  { code: 'CL', nameEn: 'UEFA Champions League', nameFa: 'لیگ قهرمانان اروپا', category: 'europe', aliases: ['ucl'] },
  { code: 'EL', nameEn: 'UEFA Europa League', nameFa: 'لیگ اروپا', category: 'europe', aliases: ['uel'] },
  { code: 'UECL', nameEn: 'UEFA Conference League', nameFa: 'لیگ کنفرانس اروپا', category: 'europe', aliases: ['uecl', 'conference league'] },
  { code: 'EC', nameEn: 'European Championship', nameFa: 'یورو', category: 'international', aliases: ['euro'] },
  { code: 'WC', nameEn: 'FIFA World Cup', nameFa: 'جام جهانی', category: 'international' },
  { code: 'DED', nameEn: 'Eredivisie', nameFa: 'اردیویزی هلند', category: 'other', aliases: ['netherlands'] },
  { code: 'PPL', nameEn: 'Primeira Liga', nameFa: 'لیگ برتر پرتغال', category: 'other', aliases: ['portugal'] },
  { code: 'BSA', nameEn: 'Campeonato Brasileiro Série A', nameFa: 'سری آ برزیل', category: 'other', aliases: ['brazil'] },
  { code: 'IR1', nameEn: 'Persian Gulf Pro League', nameFa: 'لیگ برتر خلیج فارس', category: 'iran', aliases: ['iran pro league', 'iranian premier league', 'لیگ برتر ایران'] },
  { code: 'IR2', nameEn: 'Azadegan League', nameFa: 'لیگ آزادگان', category: 'iran', aliases: ['iran league 1'] },
  { code: 'IRC', nameEn: 'Hazfi Cup', nameFa: 'جام حذفی', category: 'iran', aliases: ['iran hazfi cup', 'جام حذفی ایران'] },
  { code: 'IRS', nameEn: 'Super Cup', nameFa: 'سوپرجام', category: 'iran', aliases: ['iran super cup', 'سوپر جام'] },
  { code: 'IR3', nameEn: 'Iran League 2', nameFa: 'لیگ ۲ ایران', category: 'iran' },
  { code: 'IRW', nameEn: "Iran Women's Premier League", nameFa: 'لیگ برتر زنان ایران', category: 'iran' },
  { code: 'AFCE', nameEn: 'AFC Champions League Elite', nameFa: 'لیگ قهرمانان آسیا (نخبگان)', category: 'asia', aliases: ['acl', 'acle'] },
  { code: 'AFC2', nameEn: 'AFC Champions League Two', nameFa: 'لیگ قهرمانان آسیا ۲', category: 'asia', aliases: ['acl2'] },
];

export const CATEGORY_ORDER: CompetitionCategory[] = [
  'england', 'spain', 'italy', 'germany', 'france', 'europe', 'iran', 'asia', 'international', 'other',
];

/** Categories shown under World Football (Iranian + Asian ones live in the Iranian Football section). */
export const WORLD_CATEGORIES: CompetitionCategory[] = CATEGORY_ORDER.filter((c) => c !== 'iran' && c !== 'asia');

export const CATEGORY_LABELS: Record<CompetitionCategory, { fa: string; en: string }> = {
  england: { fa: '🇬🇧 انگلیس', en: '🇬🇧 England' },
  spain: { fa: '🇪🇸 اسپانیا', en: '🇪🇸 Spain' },
  italy: { fa: '🇮🇹 ایتالیا', en: '🇮🇹 Italy' },
  germany: { fa: '🇩🇪 آلمان', en: '🇩🇪 Germany' },
  france: { fa: '🇫🇷 فرانسه', en: '🇫🇷 France' },
  europe: { fa: '🇪🇺 رقابت‌های اروپایی', en: '🇪🇺 European competitions' },
  iran: { fa: '🇮🇷 ایران', en: '🇮🇷 Iran' },
  asia: { fa: '🌏 رقابت‌های آسیایی', en: '🌏 Asian competitions' },
  international: { fa: '🌍 رقابت‌های بین‌المللی', en: '🌍 International competitions' },
  other: { fa: '🌐 سایر کشورها', en: '🌐 Other countries' },
};

export function competitionMeta(code: string): CompetitionMeta | undefined {
  return COMPETITION_CATALOG.find((c) => c.code === code);
}

export function competitionDisplayName(code: string, fallback: string, lang: 'fa' | 'en'): string {
  const m = competitionMeta(code);
  if (!m) return fallback;
  return lang === 'fa' ? m.nameFa : m.nameEn;
}
