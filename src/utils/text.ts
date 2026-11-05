const NOISE = /\b(fc|cf|sv|sc|fk|afc|ac|as|1\.|vfb|vfl|tsg|rb|1899|04|05|09|07|ssc|us|ud|cd|sd)\b/g;

/** Latin-script team/competition name normalizer: lower-case, no accents/punctuation/club-form noise. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
