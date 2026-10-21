import { describe, expect, test } from 'bun:test';
import { measure, parsePack } from '../src/content/importer';

const answers = (n: number) => Array.from({ length: n }, (_, i) => ({ answer: `Answer ${i + 1}` }));

describe('parsePack', () => {
  test('accepts the bundled questions', async () => {
    const result = parsePack(await Bun.file(`${import.meta.dir}/../data/questions.json`).json());
    expect(result.ok).toBe(true);
  });

  test('fills in defaults', () => {
    const result = parsePack({ questions: [{ category: 'misc', question: 'Q?', answers: answers(13) }] });
    if (!result.ok) throw new Error(result.errors);
    expect(result.pack.questions[0]).toMatchObject({ cutoff: 10, difficulty: 1, tags: [] });
  });

  test('needs 3–5 tension answers just below the cutoff, no fewer and no more', () => {
    const pack = (count: number) => parsePack({ questions: [{ category: 'misc', question: 'Q?', cutoff: 5, answers: answers(count) }] });
    expect(pack(7)).toMatchObject({ ok: false, errors: expect.stringContaining('needs 8–10') });
    expect(pack(8).ok).toBe(true);
    expect(pack(10).ok).toBe(true);
    expect(pack(11)).toMatchObject({ ok: false, errors: expect.stringContaining('nothing deeper') });
  });

  test('checks "Top N" in the question against the cutoff', () => {
    const result = parsePack({ questions: [{ category: 'misc', question: 'Top 8 things', answers: answers(11) }] });
    expect(result).toMatchObject({ ok: false, errors: expect.stringContaining('set "cutoff": 8') });
    const fixed = parsePack({ questions: [{ category: 'misc', question: 'Top eight things', cutoff: 8, answers: answers(11) }] });
    expect(fixed.ok).toBe(true);
  });

  test('figures must follow the ranking, and the cutoff must not split a tie', () => {
    const ranked = (displays: string[], cutoff = 2) =>
      parsePack({
        questions: [
          { category: 'misc', question: 'Q?', cutoff, answers: displays.map((display, i) => ({ answer: `Answer ${i + 1}`, display })) },
        ],
      });
    expect(ranked(['9 km', '7 km', '5 km', '3 km', '1 km']).ok).toBe(true);
    expect(ranked(['1 day', '2 days', '50 hours', '4 days', '5 days']).ok).toBe(true);
    expect(ranked(['9 km', '5 km', '7 km', '3 km', '1 km'])).toMatchObject({ ok: false, errors: expect.stringContaining('is out of order') });
    expect(ranked(['9 km', '5 km', '5 km', '3 km', '1 km'])).toMatchObject({ ok: false, errors: expect.stringContaining('splits a tie') });
    expect(ranked(['9 km', '9 km', '5 km', '3 km', '1 km']).ok).toBe(true); // a tie inside the top section is fine
    expect(ranked(['$2.9B', '$950M', '$900M', '$1.2B', '$100M'])).toMatchObject({ ok: false, errors: expect.stringContaining('#4 Answer 4') });
  });

  test('rejects unknown fields and explains the usual suspects', () => {
    const result = parsePack({
      questions: [
        {
          category: 'misc',
          question: 'Q?',
          answers: [{ answer: 'A', rank: 1, aliasses: ['a'] }, ...answers(10)],
        },
      ],
    });
    if (result.ok) throw new Error('expected the pack to be rejected');
    expect(result.errors).toContain('ranked by their order in the list');
    expect(result.errors).toContain('Did you mean "aliases"?');
  });

  test('rejects a spelling that could match two different answers', () => {
    const result = parsePack({
      questions: [
        {
          category: 'history',
          question: 'Presidents',
          cutoff: 1,
          answers: [
            { answer: 'Theodore Roosevelt', aliases: ['Roosevelt'] },
            { answer: 'Franklin D. Roosevelt', aliases: ['roosevelt'] },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, errors: expect.stringContaining('also matches answer #1') });
  });

  test('rejects badly formed category paths', () => {
    const result = parsePack({ questions: [{ category: 'Sports / Baseball', question: 'Q?', answers: answers(11) }] });
    expect(result).toMatchObject({ ok: false, errors: expect.stringContaining('lower-case slugs') });
  });

  test('warns, without failing, about answers that typos could confuse', () => {
    const result = parsePack({
      questions: [
        {
          category: 'misc',
          question: 'Q?',
          cutoff: 1,
          answers: [{ answer: 'Phillips' }, { answer: 'Philips' }, { answer: 'Sony' }, { answer: 'Samsung' }],
        },
      ],
    });
    if (!result.ok) throw new Error(result.errors);
    expect(result.warnings).toEqual([expect.stringContaining('"Phillips" (#1) and "Philips" (#2)')]);
  });

  test('the bundled questions raise no warnings', async () => {
    const result = parsePack(await Bun.file(`${import.meta.dir}/../data/questions.json`).json());
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });
});

describe('measure', () => {
  test.each([
    ['8,849 m', 8849],
    ['$2.92B', 2.92e9],
    ['1.2 billion', 1.2e9],
    ['20 July 1969', 19690720],
    ['July 20, 1969', 19690720],
    ['Dec. 1787', 17871200],
    ['2:01:09', 7269],
    ['4,067,400 (June 2025)', 4067400],
    ['#3 — Mayday Parade, 2009', 3],
    ['#4 — 10 Years by Daði og Gagnamagnið (378 points)', 4],
    ['(June 2025)', 20250600],
  ])('%p → %p', (display, expected) => {
    expect(measure(display)).toBeCloseTo(expected);
  });
});
