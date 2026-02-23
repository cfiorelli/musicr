/**
 * Display-safe helpers for song match explanation text.
 *
 * Kept pure (no DOM/React deps) so they can be unit-tested in node.
 */

/**
 * Strip legacy confidence suffix tags from stored aboutness text.
 * Handles patterns written by old generator versions, e.g.:
 *   "Melancholic blues reflecting deep sorrow [confidence: medium]"
 *   → "Melancholic blues reflecting deep sorrow"
 */
export function cleanAboutnessText(text: string): string {
  return text.replace(/\s*\[confidence:\s*\w+\]\s*$/i, '').trim();
}

export type MatchStrength = {
  label: 'Strong match' | 'Good match' | 'Loose match';
  color: string;
};

/**
 * Map a similarity score (0–1) to a user-friendly qualitative label.
 * Returns null when the score is undefined or below the display threshold
 * (unreliable matches are better left unlabelled).
 *
 * Thresholds (tuned against the softmax confidence output):
 *   >= 0.50 → Strong match
 *   >= 0.30 → Good match
 *   >= 0.15 → Loose match
 *   <  0.15 → null (hide label)
 */
export function getMatchStrengthLabel(similarity?: number): MatchStrength | null {
  if (similarity === undefined || similarity === null) return null;
  if (similarity >= 0.5) return { label: 'Strong match', color: 'text-emerald-400' };
  if (similarity >= 0.3) return { label: 'Good match',   color: 'text-sky-400' };
  if (similarity >= 0.15) return { label: 'Loose match', color: 'text-gray-400' };
  return null;
}
