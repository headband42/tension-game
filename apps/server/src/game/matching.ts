export interface AnswerKey {
  id: string;
  rank: number;
  text: string;
  aliases: string[];
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

const ROMAN_NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];

/**
 * Reduces an answer to a comparable form: lower case, no accents or
 * punctuation, no leading article, and common abbreviations expanded.
 *
 *   "Mt. Everest" → "mount everest"    "São Paulo" → "sao paulo"
 *   "The Avengers" → "avengers"        "A's" → "as"
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
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
    const value = ROMAN_NUMERALS.indexOf(token) + 1;
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
}

function spelling(raw: string): Spelling {
  return { key: answerKey(raw), sound: soundKey(raw), numbers: numbersIn(raw) };
}

/**
 * How closely a typed answer resembles a listed spelling: the better of the
 * written and the sound-alike comparison. Numbers have to agree exactly, so
 * "Star Wars 9" is never taken for "Star Wars 7".
 */
function resemblance(typed: Spelling, listed: Spelling) {
  if (typed.numbers !== listed.numbers) return { score: 0, written: 0 };
  const written = similarity(typed.key, listed.key);
  return { score: Math.max(written, similarity(typed.sound, listed.sound)), written };
}

/** Whether a misspelling of one spelling could plausibly be scored as the other. */
export function confusable(a: string, b: string, threshold = FUZZY_THRESHOLD): boolean {
  return resemblance(spelling(a), spelling(b)).score >= threshold;
}

/**
 * Finds which official answer a submission refers to.
 *
 * 1. An exact match on the answer text or any alias wins outright.
 * 2. Otherwise the closest spelling wins, if it reaches the threshold either as
 *    written (allowing typos and swapped letters) or as it sounds.
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
    if (!candidate.spelling.key) continue;
    const { score, written } = resemblance(typed, candidate.spelling);
    if (score < threshold) continue;
    if (!best || score > best.score || (score === best.score && written > best.written)) {
      best = { answer: candidate.answer, score, written };
    }
  }

  if (!best) return NO_MATCH;
  return { answerId: best.answer.id, rank: best.answer.rank, method: 'fuzzy', similarity: best.score };
}
