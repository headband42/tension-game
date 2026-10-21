import { describe, expect, test } from 'bun:test';
import { MISS_PENALTY, TENSION_PENALTY, pointsForRank } from '@tension/shared';
import {
  decoyIndex,
  decoysFor,
  editDistance,
  matchAnswer,
  normalizeAnswer,
  numbersIn,
  similarity,
  soundKey,
  type AnswerKey,
} from '../src/game/matching';

const answers: AnswerKey[] = [
  { id: 'everest', rank: 1, text: 'Mount Everest', aliases: ['everest', 'sagarmatha'] },
  { id: 'k2', rank: 2, text: 'K2', aliases: [] },
  { id: 'cards', rank: 3, text: 'St. Louis Cardinals', aliases: ['cardinals'] },
  { id: 'saopaulo', rank: 4, text: 'São Paulo', aliases: [] },
  { id: 'spidey', rank: 5, text: 'Spider-Man: No Way Home', aliases: ['no way home'] },
  { id: 'as', rank: 6, text: 'Athletics', aliases: ['as'] },
  { id: 'g1', rank: 11, text: 'Gasherbrum I', aliases: [] },
  { id: 'g2', rank: 13, text: 'Gasherbrum II', aliases: [] },
];

describe('normalizeAnswer', () => {
  test.each([
    ['Mt. Everest', 'mount everest'],
    ['MOUNT  everest!', 'mount everest'],
    ['The Avengers', 'avengers'],
    ['São Paulo', 'sao paulo'],
    ["A's", 'as'],
    ['St Louis', 'saint louis'],
    ['Stockholm', 'stockholm'],
    ['Mountain Dew', 'mountain dew'],
    ['Ocean’s Eleven', 'oceans eleven'],
    ['Seven Samurai', '7 samurai'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ['Đặng', 'dang'],
    ['Łódź', 'lodz'],
    ['Øresund', 'oresund'],
    ['Æon', 'aeon'],
  ])('%p → %p', (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });
});

describe('matchAnswer', () => {
  test.each([
    ['Mount Everest', 'everest', 'exact'],
    ['mt everest', 'everest', 'exact'],
    ['Sagarmatha', 'everest', 'exact'],
    ['k2', 'k2', 'exact'],
    ['st louis cardinals', 'cards', 'exact'],
    ['Sao Paulo', 'saopaulo', 'exact'],
    ['spiderman no way home', 'spidey', 'exact'],
    ["a's", 'as', 'exact'],
    ['Mount Everst', 'everest', 'fuzzy'],
    ['Gasherbrum I', 'g1', 'exact'],
    ['Gasherbrum II', 'g2', 'exact'],
  ])('%p matches %p (%s)', (input, id, method) => {
    const match = matchAnswer(input, answers);
    expect(match.answerId).toBe(id);
    expect(match.method).toBe(method as 'exact' | 'fuzzy');
  });

  test('a misspelling never bridges different numbers', () => {
    const sequels: AnswerKey[] = [{ id: 'sw7', rank: 1, text: 'Star Wars Episode VII', aliases: ['star wars 7'] }];
    expect(matchAnswer('Star Wars 7', sequels).answerId).toBe('sw7');
    expect(matchAnswer('Star Wars Episode 7', sequels).answerId).toBe('sw7');
    expect(matchAnswer('Star Wars 9', sequels).answerId).toBeNull();
    expect(matchAnswer('Star Wars', sequels).answerId).toBeNull();
  });

  test('a misspelling never bridges opposite directions or different weekdays', () => {
    const keys: AnswerKey[] = [
      { id: 'skorea', rank: 1, text: 'South Korea', aliases: [] },
      { id: 'wgermany', rank: 2, text: 'West Germany', aliases: [] },
      { id: 'mnf', rank: 3, text: 'Monday Night Football', aliases: [] },
    ];
    expect(matchAnswer('North Korea', keys).answerId).toBeNull();
    expect(matchAnswer('East Germany', keys).answerId).toBeNull();
    expect(matchAnswer('Sunday Night Football', keys).answerId).toBeNull();
    expect(matchAnswer('Sotuh Korea', keys).answerId).toBe('skorea');
    expect(matchAnswer('Monday Nite Football', keys).answerId).toBe('mnf');
  });

  test('Roman numerals past XV are numbers too', () => {
    const games: AnswerKey[] = [{ id: 'sb49', rank: 1, text: 'Super Bowl XLIX', aliases: [] }];
    expect(matchAnswer('Super Bowl 49', games).answerId).toBe('sb49');
    expect(matchAnswer('Super Bowl XLX', games).answerId).toBeNull();
    expect(matchAnswer('Super Bowl LIX', games).answerId).toBeNull();
    expect(matchAnswer('Super Bowl L', [{ id: 'sb50', rank: 1, text: 'Super Bowl 50', aliases: [] }]).answerId).toBe('sb50');
    expect(numbersIn('Jet Li')).toBe('');
  });

  test('a misspelling never lands on an answer the bank lists beside what was typed', () => {
    const index = decoyIndex([
      [
        { text: 'Netherlands', aliases: ['Holland'] },
        { text: 'Poland', aliases: [] },
      ],
      [
        { text: 'Iceland', aliases: [] },
        { text: 'Ireland', aliases: [] },
      ],
    ]);
    const keys: AnswerKey[] = [
      { id: 'ned', rank: 1, text: 'Netherlands', aliases: ['Holland'] },
      { id: 'isl', rank: 2, text: 'Iceland', aliases: [] },
    ].map((answer) => ({ ...answer, decoys: decoysFor(answer, index) }));
    expect(matchAnswer('Poland', keys).answerId).toBeNull();
    expect(matchAnswer('Ireland', keys).answerId).toBeNull();
    expect(matchAnswer('Hollnad', keys).answerId).toBe('ned');
    expect(matchAnswer('Icelnad', keys).answerId).toBe('isl');
  });

  test('matches by sound when the spelling is too far off', () => {
    const teams: AnswerKey[] = [{ id: 'phils', rank: 1, text: 'Philadelphia Phillies', aliases: [] }];
    expect(matchAnswer('Filadelfia Fillies', teams)).toMatchObject({ answerId: 'phils', method: 'fuzzy' });
  });

  test('unrelated and blank answers do not match', () => {
    expect(matchAnswer('Mount Doom', answers).answerId).toBeNull();
    expect(matchAnswer('K3', answers).answerId).toBeNull();
    expect(matchAnswer('   ', answers).method).toBe('none');
  });

  test('very short answers only match exactly', () => {
    const letters: AnswerKey[] = ['E', 'T', 'C', 'S', 'I'].map((l, i) => ({ id: l, rank: i + 1, text: l, aliases: [] }));
    expect(matchAnswer('c', letters).answerId).toBe('C');
    for (const wrong of ['K', 'Q', 'Z', 'X', 'Y']) expect(matchAnswer(wrong, letters).answerId).toBeNull();
    const countries: AnswerKey[] = [{ id: 'uk', rank: 1, text: 'United Kingdom', aliases: ['UK'] }];
    expect(matchAnswer('UK', countries).answerId).toBe('uk');
    expect(matchAnswer('US', countries).answerId).toBeNull();
  });

  test('an exact match beats an earlier, closer-looking fuzzy one', () => {
    const keys: AnswerKey[] = [
      { id: 'a', rank: 1, text: 'Austria', aliases: [] },
      { id: 'b', rank: 2, text: 'Australia', aliases: [] },
    ];
    expect(matchAnswer('australia', keys).answerId).toBe('b');
  });

  test('similarity is symmetric and bounded', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('kitten', 'sitting')).toBeCloseTo(similarity('sitting', 'kitten'));
  });
});

describe('editDistance', () => {
  test('counts a swap of neighbouring letters as one edit', () => {
    expect(editDistance('mexico', 'mexcio')).toBe(1);
    expect(editDistance('garfield', 'garfeild')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('soundKey', () => {
  test.each([
    ['Philadelphia Phillies', 'Filadelfia Fillies'],
    ['Red Sox', 'Red Socks'],
    ['Celtics', 'Seltics'],
    ['Knicks', 'Nicks'],
    ['Dhaka', 'Daka'],
    ['Lhotse', 'Lotse'],
    ['Tokyo', 'Tokio'],
    ['Frozen II', 'Frozen 2'],
  ])('%p sounds like %p', (a, b) => {
    expect(soundKey(a)).toBe(soundKey(b));
  });

  test('keeps different-sounding names apart', () => {
    expect(soundKey('Iran')).not.toBe(soundKey('Iraq'));
    expect(soundKey('Bucks')).not.toBe(soundKey('Bulls'));
  });
});

describe('numbersIn', () => {
  test.each([
    ['Star Wars Episode VII', '7'],
    ['Gasherbrum I', '1'],
    ['Gasherbrum two', '2'],
    ['Super Bowl LIX', '59'],
    ['Super Bowl XL', '40'],
    ['76ers', '76'],
    ['K2', '2'],
    ['X-Men', ''],
    ['I, Robot', ''],
    ['Mount Everest', ''],
  ])('%p → %p', (input, expected) => {
    expect(numbersIn(input)).toBe(expected);
  });
});

describe('pointsForRank', () => {
  test('ranks inside the cutoff score their rank; outside is tension; unranked is a miss', () => {
    expect(pointsForRank(1, 10)).toBe(1);
    expect(pointsForRank(10, 10)).toBe(10);
    expect(pointsForRank(11, 10)).toBe(TENSION_PENALTY);
    expect(pointsForRank(9, 8)).toBe(TENSION_PENALTY);
    expect(pointsForRank(null, 10)).toBe(MISS_PENALTY);
  });
});
