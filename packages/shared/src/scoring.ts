/** Points for an answer that is on the list but ranked past the question's cutoff. */
export const TENSION_PENALTY = -5;

/** Points for an answer that is not on the list at all, including a blank answer. */
export const MISS_PENALTY = -3;

/** A doubled answer multiplies its points, good or bad. */
export const DOUBLE_MULTIPLIER = 2;

/** The default cutoff: answers ranked #1–#10 score, #11+ are "tension". */
export const DEFAULT_CUTOFF = 10;

/**
 * Every question lists 3–5 tension answers: the entries just below the cutoff.
 * Anything deeper on the real ranking is deliberately left off, so missing by a
 * lot (−3) costs less than missing by a little (−5), as on the TENS10N show.
 */
export const MIN_TENSION_ANSWERS = 3;
export const MAX_TENSION_ANSWERS = 5;

/**
 * - `hit`: ranked at or above the cutoff, worth its rank in points (#1 = 1, #10 = 10)
 * - `tension`: on the list but past the cutoff
 * - `miss`: not on the list (or blank)
 */
export type Outcome = 'hit' | 'tension' | 'miss';

export function outcomeForRank(rank: number | null, cutoff: number): Outcome {
  if (rank === null) return 'miss';
  return rank <= cutoff ? 'hit' : 'tension';
}

/** Points for a matched rank before any double is applied. */
export function pointsForRank(rank: number | null, cutoff: number): number {
  if (rank === null) return MISS_PENALTY;
  return rank <= cutoff ? rank : TENSION_PENALTY;
}
