import { describe, expect, test } from 'bun:test';
import { parsePack } from '../src/content/importer';

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

  test('needs at least three tension answers below the cutoff', () => {
    const result = parsePack({ questions: [{ category: 'misc', question: 'Q?', cutoff: 5, answers: answers(7) }] });
    expect(result).toMatchObject({ ok: false, errors: expect.stringContaining('needs at least 8') });
    expect(parsePack({ questions: [{ category: 'misc', question: 'Q?', cutoff: 5, answers: answers(8) }] }).ok).toBe(true);
  });

  test('checks "Top N" in the question against the cutoff', () => {
    const result = parsePack({ questions: [{ category: 'misc', question: 'Top 8 things', answers: answers(11) }] });
    expect(result).toMatchObject({ ok: false, errors: expect.stringContaining('set "cutoff": 8') });
    const fixed = parsePack({ questions: [{ category: 'misc', question: 'Top eight things', cutoff: 8, answers: answers(11) }] });
    expect(fixed.ok).toBe(true);
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
