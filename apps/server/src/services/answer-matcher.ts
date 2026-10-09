// Answer normalization and matching utilities

const FUZZY_THRESHOLD = 0.8;

export function normalizeAnswer(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '') // Remove leading articles
    .replace(/^(mount|mt\.?|mt\s)/i, 'mount ') // Mt/Mount → Mount
    .replace(/^(st\.?|st\s)/i, 'saint ') // St → Saint
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  text = expandNumbers(text);
  return text;
}

export function expandNumbers(text: string): string {
  const words: Record<string, string> = {
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
  return text.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
    (m) => words[m]
  );
}

export function calculatePoints(rank: number, tensionCutoff: number = 10): number {
  if (rank >= 1 && rank <= tensionCutoff) {
    return rank; // #1 = 1pt, #10 = 10pts
  }
  if (rank > tensionCutoff) {
    return -5; // Tension - on the list but past cutoff
  }
  return -3; // Unknown - not on list
}

// Levenshtein distance for fuzzy matching
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return (maxLen - distance) / maxLen;
}

export interface AnswerCandidate {
  id: string;
  rank: number;
  answerText: string;
  aliases: string; // JSON string array
}

export interface MatchResult {
  rank: number | null;
  points: number;
  method: 'exact' | 'alias' | 'fuzzy' | 'unknown';
  answerMatchId: string | null;
  confidence?: number;
}

/**
 * Match a submitted answer against the official list.
 * Order: exact → alias → fuzzy (Levenshtein ≥ threshold).
 */
export function matchAnswer(
  rawSubmission: string,
  answers: AnswerCandidate[],
  tensionCutoff: number = 10,
  fuzzyThreshold: number = FUZZY_THRESHOLD
): MatchResult {
  const normalized = normalizeAnswer(rawSubmission || '');

  if (!normalized) {
    return { rank: null, points: -3, method: 'unknown', answerMatchId: null };
  }

  // Step 1: Exact match on answer text
  for (const answer of answers) {
    const normalizedText = normalizeAnswer(answer.answerText);
    if (normalized === normalizedText) {
      return {
        rank: answer.rank,
        points: calculatePoints(answer.rank, tensionCutoff),
        method: 'exact',
        answerMatchId: answer.id,
      };
    }
  }

  // Step 2: Alias match
  for (const answer of answers) {
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(answer.aliases || '[]');
    } catch {
      aliases = [];
    }
    const normalizedAliases = aliases.map((a) => normalizeAnswer(a));
    if (normalizedAliases.includes(normalized)) {
      return {
        rank: answer.rank,
        points: calculatePoints(answer.rank, tensionCutoff),
        method: 'alias',
        answerMatchId: answer.id,
      };
    }
  }

  // Step 3: Fuzzy match — pick best similarity above threshold
  let best: { answer: AnswerCandidate; similarity: number } | null = null;

  for (const answer of answers) {
    const candidates = [normalizeAnswer(answer.answerText)];
    try {
      const aliases: string[] = JSON.parse(answer.aliases || '[]');
      candidates.push(...aliases.map((a) => normalizeAnswer(a)));
    } catch {
      // ignore
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      const similarity = levenshteinSimilarity(normalized, candidate);
      if (similarity >= fuzzyThreshold) {
        if (!best || similarity > best.similarity) {
          best = { answer, similarity };
        }
      }
    }
  }

  if (best) {
    return {
      rank: best.answer.rank,
      points: calculatePoints(best.answer.rank, tensionCutoff),
      method: 'fuzzy',
      answerMatchId: best.answer.id,
      confidence: best.similarity,
    };
  }

  return { rank: null, points: -3, method: 'unknown', answerMatchId: null };
}

/** Fisher–Yates shuffle (in place copy) */
export function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
