import { describe, expect, test } from 'bun:test';
import { matchAnswer, type AnswerKey } from '../src/game/matching';
import { QUESTIONS, SHOULD_MATCH, SHOULD_NOT_MATCH } from './typo-corpus';

const pack: { questions: { question: string; answers: { answer: string; aliases?: string[] }[] }[] } =
  await Bun.file(`${import.meta.dir}/../data/questions.json`).json();

function answersFor(label: keyof typeof QUESTIONS): AnswerKey[] {
  const question = pack.questions.find((q) => q.question === QUESTIONS[label]);
  if (!question) throw new Error(`starter pack has no question "${QUESTIONS[label]}"`);
  return question.answers.map((a, i) => ({ id: a.answer, rank: i + 1, text: a.answer, aliases: a.aliases ?? [] }));
}

describe('misspellings of starter answers are credited', () => {
  test.each(SHOULD_MATCH)('%s: %p → %p', (question, typed, expected) => {
    expect(matchAnswer(typed, answersFor(question)).answerId).toBe(expected);
  });
});

describe('wrong answers that look like right ones are not', () => {
  test.each(SHOULD_NOT_MATCH)('%s: %p', (question, typed) => {
    expect(matchAnswer(typed, answersFor(question)).answerId).toBeNull();
  });
});
