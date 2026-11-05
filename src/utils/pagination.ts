/**
 * Splits items into pages so that each page holds at most `maxItems` items and its
 * rendered size stays within `maxChars`. `size(item)` estimates the characters an item adds.
 * Always makes progress: an oversize single item gets its own page.
 */
export function paginate<T>(items: T[], opts: { maxItems: number; maxChars: number; size: (item: T) => number }): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of items) {
    const s = opts.size(it);
    if (cur.length && (cur.length >= opts.maxItems || chars + s > opts.maxChars)) {
      pages.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += s;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(page, Math.max(total - 1, 0));
}

export const TELEGRAM_TEXT_LIMIT = 4096;

/** Hard guard so editMessageText never fails on length. Cuts at a line boundary. */
export function clampText(text: string, limit = TELEGRAM_TEXT_LIMIT - 96): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const nl = cut.lastIndexOf('\n');
  return (nl > limit * 0.5 ? cut.slice(0, nl) : cut) + '\n…';
}
