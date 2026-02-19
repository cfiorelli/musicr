/**
 * Keyword content filter
 *
 * Reads BLOCKED_KEYWORDS env var (comma-separated) at startup.
 * Checks messages against the list using whole-word, case-insensitive matching.
 * No regex-injection risk: each keyword is escaped before compilation.
 *
 * Usage:
 *   BLOCKED_KEYWORDS="spam,hate,badword" node dist/index.js
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseKeywords(): RegExp[] {
  const raw = process.env.BLOCKED_KEYWORDS ?? '';
  if (!raw.trim()) return [];

  const patterns = raw
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean)
    .map(k => new RegExp(`\\b${escapeRegex(k)}\\b`, 'i'));

  if (patterns.length > 0) {
    console.warn(`[content-filter] Active: blocking ${patterns.length} keyword pattern(s)`);
  }
  return patterns;
}

const blockedPatterns: RegExp[] = parseKeywords();

/**
 * Returns true if the text contains any blocked keyword (whole-word match).
 */
export function containsBlockedKeyword(text: string): boolean {
  if (blockedPatterns.length === 0) return false;
  return blockedPatterns.some(re => re.test(text));
}

export function getBlockedKeywordCount(): number {
  return blockedPatterns.length;
}
