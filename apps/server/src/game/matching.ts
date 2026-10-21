export interface AnswerKey {
  id: string;
  rank: number;
  text: string;
  aliases: string[];
  /**
   * Keys (see answerKey) of other answers that a misspelling of this one must
   * never be taken for, because the question bank lists them side by side:
   * "poland" for the Netherlands (alias Holland). See decoyIndex.
   */
  decoys?: string[];
}

export interface Match {
  answerId: string | null;
  rank: number | null;
  method: 'exact' | 'fuzzy' | 'none';
  similarity: number;
}

/** Minimum similarity (0–1) for a misspelling to still count. */
export const FUZZY_THRESHOLD = 0.8;

const NO_MATCH: Match = { answerId: null, rank: null, method: 'none', similarity: 0 };

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

/** Roman numerals from I to LXXXIX, the range answers use (Rocky IV, Super Bowl LIX). */
const ROMAN_NUMERAL = /^(?:xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_DIGITS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
/** Numeral-shaped words that are usually names: Jet Li, Liv Tyler. */
const NOT_NUMERALS = new Set(['li', 'liv']);

function romanValue(token: string): number {
  if (!token || NOT_NUMERALS.has(token) || !ROMAN_NUMERAL.test(token)) return 0;
  let total = 0;
  for (let i = 0; i < token.length; i++) {
    const digit = ROMAN_DIGITS[token[i]];
    total += digit < (ROMAN_DIGITS[token[i + 1]] ?? 0) ? -digit : digit;
  }
  return total;
}

/**
 * Reduces an answer to a comparable form: lower case, no accents or
 * punctuation, no leading article, and common abbreviations expanded.
 *
 *   "Mt. Everest" → "mount everest"    "São Paulo" → "sao paulo"
 *   "The Avengers" → "avengers"        "A's" → "as"
 */
/** Letters that Unicode doesn't split into a base letter plus an accent, so NFKD leaves them alone. */
const UNSPLIT_LETTERS: Record<string, string> = {
  đ: 'd', ð: 'd', ħ: 'h', ı: 'i', ł: 'l', ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', þ: 'th',
};

export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[đðħıłøœæßþ]/g, (letter) => UNSPLIT_LETTERS[letter])
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bst\b/g, 'saint')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => NUMBER_WORDS[word]);
}

/** Normalized form with spaces removed, so "spider man" and "Spider-Man" compare equal. */
export function answerKey(raw: string): string {
  return normalizeAnswer(raw).replace(/ /g, '');
}

/**
 * Words with Roman numerals read as numbers ("Frozen II" → frozen, 2). A
 * one-letter numeral only counts as the last word, so "X-Men" and "I, Robot"
 * keep their letters while "Gasherbrum I" and "Malcolm X" become numbers.
 */
function words(raw: string): string[] {
  const tokens = normalizeAnswer(raw).split(' ').filter(Boolean);
  return tokens.map((token, i) => {
    const value = romanValue(token);
    const counts = value > 0 && tokens.length > 1 && (token.length > 1 || i === tokens.length - 1);
    return counts ? String(value) : token;
  });
}

/** Rewrites English spellings that sound alike to one form. Applied per word. */
const SOUND_RULES: [RegExp, string][] = [
  [/^(?:kn|gn|pn)/, 'n'], // knicks → nicks
  [/^wr/, 'r'],
  [/^ps/, 's'],
  [/^x/, 's'], // xixabangma
  [/ph/g, 'f'], // phillies → fillies
  [/wh/g, 'w'],
  [/ck/g, 'k'],
  [/q/g, 'k'], // chongqing → chongking
  [/x/g, 'ks'], // sox → soks, like socks
  [/c(?=[eiy])/g, 's'], // celtics → seltics
  [/c(?!h)/g, 'k'], // cairo → kairo
  [/z/g, 's'],
  [/([bdfgjklmnrv])h/g, '$1'], // dhaka → daka, lhotse → lotse, khan → kan
  [/y/g, 'i'], // libya → libia
  [/([a-z])\1+/g, '$1'], // annapurna → anapurna
];

/** How an answer sounds, roughly: "Philadelphia Phillies" and "Filadelfia Fillies" share one. */
export function soundKey(raw: string): string {
  return words(raw)
    .map((word) => SOUND_RULES.reduce((w, [pattern, replacement]) => w.replace(pattern, replacement), word))
    .join('');
}

/** Every number in an answer, in order: "Star Wars Episode VII" → "7", "76ers" → "76". */
export function numbersIn(raw: string): string {
  return words(raw)
    .flatMap((word) => word.match(/\d+/g) ?? [])
    .join(' ');
}

/** Words that tell otherwise identical names apart: North / South Korea, Monday / Sunday Night Football. */
const MARKERS = new Set([
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/** The direction and weekday words in an answer: "East Germany" → "east", "Monday Night Football" → "monday". */
export function markersIn(raw: string): string {
  return words(raw)
    .filter((word) => MARKERS.has(word))
    .join(' ');
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and
 * swaps of two neighbouring letters ("Lybia" for "Libya") each cost one edit.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : (longest - editDistance(a, b)) / longest;
}

interface Spelling {
  key: string;
  sound: string;
  numbers: string;
  markers: string;
}

function spelling(raw: string): Spelling {
  return { key: answerKey(raw), sound: soundKey(raw), numbers: numbersIn(raw), markers: markersIn(raw) };
}

/** Spellings shorter than this only ever match exactly: one typo in "C" or "UK" is a different answer. */
export const MIN_FUZZY_LENGTH = 4;

/**
 * How closely a typed answer resembles a listed spelling: the better of the
 * written and the sound-alike comparison. Numbers have to agree exactly, so
 * "Star Wars 9" is never taken for "Star Wars 7"; so do direction and weekday
 * words when both sides have one, so "North Korea" is never taken for "South
 * Korea" (a typo in the word itself, "Sotuh Korea", still counts); and very
 * short spellings have to agree exactly, so the letter "K" is never taken for "C".
 */
function resemblance(typed: Spelling, listed: Spelling) {
  if (typed.numbers !== listed.numbers) return { score: 0, written: 0 };
  if (typed.markers && listed.markers && typed.markers !== listed.markers) return { score: 0, written: 0 };
  if (Math.min(typed.key.length, listed.key.length) < MIN_FUZZY_LENGTH) return { score: 0, written: 0 };
  const written = similarity(typed.key, listed.key);
  return { score: Math.max(written, similarity(typed.sound, listed.sound)), written };
}

/** Whether a misspelling of one spelling could plausibly be scored as the other. */
export function confusable(a: string, b: string, threshold = FUZZY_THRESHOLD): boolean {
  return resemblance(spelling(a), spelling(b)).score >= threshold;
}

/** Spellings that other answers' spellings can be confused with, by answer key. */
export type DecoyIndex = Map<string, Set<string>>;

/**
 * Indexes every pair of look-alike spellings that some question lists as
 * different answers. Poland and the Netherlands (alias Holland) share medal
 * tables, so "Poland" and "Holland" are indexed against each other. Iceland and
 * Ireland too. A typed "Poland" is then never scored as the Netherlands, even
 * in a list Poland isn't on. Pass each question's answers.
 */
export function decoyIndex(questions: Iterable<{ text: string; aliases: string[] }[]>): DecoyIndex {
  const index: DecoyIndex = new Map();
  const link = (a: string, b: string) => {
    if (!index.has(a)) index.set(a, new Set());
    index.get(a)!.add(b);
  };
  // The same names recur across questions (every medal table lists the United States).
  const profiles = new Map<string, Profile>();
  const profileOf = (raw: string) => profiles.get(raw) ?? profiles.set(raw, profile(raw)).get(raw)!;
  for (const answers of questions) {
    const spellings = answers.map((answer) => [answer.text, ...answer.aliases].map(profileOf).filter((p) => p.spelling.key));
    for (let i = 0; i < spellings.length; i++) {
      for (let j = i + 1; j < spellings.length; j++) {
        for (const a of spellings[i]) {
          for (const b of spellings[j]) {
            if (a.spelling.key === b.spelling.key || !couldResemble(a, b)) continue;
            if (resemblance(a.spelling, b.spelling).score < FUZZY_THRESHOLD) continue;
            link(a.spelling.key, b.spelling.key);
            link(b.spelling.key, a.spelling.key);
          }
        }
      }
    }
  }
  return index;
}

/** The decoys for one answer: look-alikes of its spellings that other questions list beside them. */
export function decoysFor(answer: { text: string; aliases: string[] }, index: DecoyIndex): string[] {
  const own = new Set([answer.text, ...answer.aliases].map(answerKey));
  const decoys = new Set<string>();
  for (const key of own) for (const decoy of index.get(key) ?? []) if (!own.has(decoy)) decoys.add(decoy);
  return [...decoys];
}

/** A spelling with its letter counts, for ruling out pairs cheaply. */
interface Profile {
  spelling: Spelling;
  keyLetters: Uint8Array;
  soundLetters: Uint8Array;
}

function profile(raw: string): Profile {
  const s = spelling(raw);
  return { spelling: s, keyLetters: letterCounts(s.key), soundLetters: letterCounts(s.sound) };
}

/** Counts of a to z, 0 to 9 and anything else. */
function letterCounts(text: string) {
  const counts = new Uint8Array(37);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const slot = code >= 97 && code <= 122 ? code - 97 : code >= 48 && code <= 57 ? code - 22 : 36;
    if (counts[slot] < 255) counts[slot]++;
  }
  return counts;
}

/**
 * A cheap bound on resemblance: an edit adds or removes at most one letter on
 * each side, so the letters one spelling has and the other lacks are no more
 * than the edit distance. Pairs too far apart on that count can't reach the threshold.
 */
function couldResemble(a: Profile, b: Profile) {
  return (
    withinReach(a.spelling.key, b.spelling.key, a.keyLetters, b.keyLetters) ||
    withinReach(a.spelling.sound, b.spelling.sound, a.soundLetters, b.soundLetters)
  );
}

function withinReach(x: string, y: string, xLetters: Uint8Array, yLetters: Uint8Array) {
  const longest = Math.max(x.length, y.length);
  let onlyX = 0;
  let onlyY = 0;
  for (let i = 0; i < 37; i++) {
    const gap = xLetters[i] - yLetters[i];
    if (gap > 0) onlyX += gap;
    else onlyY -= gap;
  }
  return longest - Math.max(onlyX, onlyY) >= FUZZY_THRESHOLD * longest;
}

/**
 * Finds which official answer a submission refers to.
 *
 * 1. An exact match on the answer text or any alias wins outright.
 * 2. Otherwise the closest spelling wins, if it reaches the threshold either as
 *    written (allowing typos and swapped letters) or as it sounds, unless what
 *    was typed is one of that answer's decoys: another real answer, spelled exactly.
 */
export function matchAnswer(raw: string, answers: AnswerKey[], threshold = FUZZY_THRESHOLD): Match {
  const typed = spelling(raw);
  if (!typed.key) return NO_MATCH;

  const candidates = answers.flatMap((answer) =>
    [answer.text, ...answer.aliases].map((text) => ({ answer, spelling: spelling(text) })),
  );

  const exact = candidates.find((c) => c.spelling.key && c.spelling.key === typed.key);
  if (exact) return { answerId: exact.answer.id, rank: exact.answer.rank, method: 'exact', similarity: 1 };

  let best: { answer: AnswerKey; score: number; written: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.spelling.key || candidate.answer.decoys?.includes(typed.key)) continue;
    const { score, written } = resemblance(typed, candidate.spelling);
    if (score < threshold) continue;
    if (!best || score > best.score || (score === best.score && written > best.written)) {
      best = { answer: candidate.answer, score, written };
    }
  }

  if (!best) return NO_MATCH;
  return { answerId: best.answer.id, rank: best.answer.rank, method: 'fuzzy', similarity: best.score };
}
