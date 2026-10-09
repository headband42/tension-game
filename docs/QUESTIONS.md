# Writing questions

Questions come in **question packs**: JSON files you load with the import command. The starter pack
is [`apps/server/data/questions.json`](../apps/server/data/questions.json).

## The answer list

Each question has **one ranked list of answers, best first**. The list has two parts:

```
answers[0]  … answers[cutoff-1]    the top section: #1 scores 1 point, #2 scores 2, … #cutoff scores cutoff
answers[cutoff] … the end          the tension zone: on the list, but every one of these costs −5
```

Anything a player types that isn't on the list at all costs −3.

- The **position** in the list is the rank. There's no `rank` field.
- Every question needs **at least 3 tension answers** below the cutoff. `cutoff` defaults to 10,
  so a plain "Top 10" question needs **at least 13 answers**: the ten that score, then three or
  more ranked below them. In general you need at least `cutoff + 3`. The import rejects a question
  with fewer, and the game never draws one.
- 3–5 tension answers is a good range. If the real list keeps going, listing more is fairer:
  anything correct that you leave off scores −3 instead of −5. The starter pack lists 5–15 tension
  answers per question.

## Format

```json
{
  "categories": [{ "path": "science/space", "name": "Space" }],
  "questions": [
    {
      "category": "science/space",
      "question": "Top 5 largest planets in the solar system",
      "cutoff": 5,
      "difficulty": 1,
      "submitter": "ande",
      "source": "NASA, by diameter",
      "tags": ["science", "planets"],
      "answers": [
        { "answer": "Jupiter", "display": "139,820 km" },
        { "answer": "Saturn", "display": "116,460 km" },
        { "answer": "Uranus", "display": "50,724 km" },
        { "answer": "Neptune", "display": "49,244 km" },
        { "answer": "Earth", "display": "12,742 km", "aliases": ["the earth", "terra"] },
        { "answer": "Venus", "display": "12,104 km" },
        { "answer": "Mars", "display": "6,779 km" },
        { "answer": "Mercury", "display": "4,879 km" }
      ]
    }
  ]
}
```

Here the cutoff is 5, so Jupiter scores 1 point and Earth scores 5. Venus, Mars and Mercury are the
tension zone (−5 each). Pluto isn't on the list (−3).

### Question fields

| Field        | Required | Notes                                                                        |
| ------------ | -------- | ---------------------------------------------------------------------------- |
| `category`   | yes      | Lower-case slugs separated by `/`. Any missing parent categories are created. |
| `question`   | yes      | Shown exactly as written. Together with `category`, it identifies the question for `--replace`. If it says "Top N", N must equal the cutoff. |
| `answers`    | yes      | The ranked list described above: at least `cutoff + 3` entries.               |
| `cutoff`     | no       | How many answers score. Default 10. Use it to dodge ties (see below).         |
| `difficulty` | no       | 1–5, default 1. Stored but not used yet.                                      |
| `submitter`, `source`, `tags` | no | Bookkeeping. The game doesn't use these yet.                       |

### Answer fields

| Field     | Required | Notes                                                                       |
| --------- | -------- | --------------------------------------------------------------------------- |
| `answer`  | yes      | The name shown at the reveal. Also accepted as typed.                        |
| `display` | no       | The fact behind the ranking ("8,849 m", "27 titles"), shown at the reveal.   |
| `aliases` | no       | Other names that should count: last names, nicknames, old names, short forms. |

### Categories

`categories` is optional. Use it when a category's display name isn't just its slug in title case:
`sports/baseball` becomes "Baseball" automatically, but `history/us-presidents` would become
"Us Presidents".

## Importing

```bash
bun run import my-pack.json             # adds new questions; skips ones already imported
bun run import my-pack.json --replace   # also overwrites existing questions and their answers
bun run import a.json b.json --dry-run  # validates without touching the database
```

A question counts as existing when it has the same category and the same question text. If you
change a question's text, the import adds it as a new question. To retire the old version, set
its `active` flag to false in `bun run db:studio`. Inactive questions and empty categories never
appear in the game.

### What the import checks

The import **rejects** a pack, naming the exact entry, when:

- a question has fewer than `cutoff + 3` answers, so fewer than 3 tension answers;
- the question says "Top N" but the cutoff isn't N (for example "Top 8" with the default cutoff of 10);
- one spelling would match two different answers (for example `"roosevelt"` as an alias on both
  Roosevelts), or an answer has no letters or digits at all;
- a category path isn't made of lower-case slugs;
- a field name isn't recognised. Typos can't vanish silently: `"aliasses"` gets "Did you mean
  "aliases"?", and fields from the old format, such as `rank`, `points` or `questionText`, get an
  explanation of what to do instead.

It **warns**, but still imports, when two different answers are so alike that a misspelling of one
could be scored as the other (say, "Phillips" and "Philips" on the same list). Check that both
really belong, and that the spellings are right.

```
✗ my-pack.json is not a valid question pack:
✖ lists 11 answers, but a cutoff of 10 needs at least 13: the top 10 that score, then at least 3 tension answers ranked below them
  → at questions[3].answers
✖ "rank" isn't a field: answers are ranked by their order in the list, so remove "rank" and put them in order, #1 first
  → at questions[5].answers[0]
```

## How typed answers are matched

You don't need aliases for typos or formatting. The game matches answers in three steps.

**1. Tidy up.** Both the typed answer and every listed spelling (answer plus aliases) are lower-cased.
Then the game strips accents, punctuation and spaces, drops a leading "the", "a" or "an", expands
"Mt"/"St", and turns number words into digits. So "spider man", "Spider-Man" and "SPIDERMAN" are
the same answer, and so are "São Paulo" and "sao paulo". If the tidied text equals a listed
spelling, it's an exact match.

**2. Forgive typos.** Otherwise, the closest listed spelling counts if it's at least 80% similar.
Similarity is measured in single edits: a wrong, missing or extra letter, or two neighbouring
letters swapped ("Mexcio"). In practice:

| Length of the answer | Typos allowed | Example                    |
| -------------------- | ------------- | -------------------------- |
| 4 characters or fewer | none         | "Mars", "K2" must be exact |
| 5–9                  | 1             | "Canda" → Canada           |
| 10–14                | 2             | "Saudia Arabea" → Saudi Arabia |
| 15 and up            | 3 or more     | "Harry Potter Deathly Hallows Part 2" |

The same comparison also runs on how the answer **sounds**, using common English spelling swaps:
ph/f, c/k/s, ck/k, q/k, x/ks, z/s, y/i, a silent h after a consonant, and doubled letters. That
catches "Filadelfia Fillies", "Red Socks", "Seltics", "Lotse" and "Tokio", which are too far off
letter by letter. It also lets short answers through when they're spelled by ear ("Marz").

**3. Numbers must agree.** Digits, number words and Roman numerals are compared as numbers, and a
fuzzy match is only allowed when they're identical. "Frozen 2", "Frozen Two" and "Frozen II" all
match Frozen II. "Star Wars 9" never matches "Star Wars 7", "Annapurna II" never matches Annapurna,
and "Top Gun" never matches "Top Gun 2". A one-letter numeral (I, V, X) only counts as a number at
the end of an answer, so "X-Men" and "I, Robot" keep their letters.

If two listed answers are equally close, the one that's closer as written wins, then the
higher-ranked one.

### What still needs an alias

Matching works on spelling, not meaning. Add aliases for:

- **Different words for the same thing:** last names ("Lincoln"), nicknames ("Teddy Roosevelt",
  "Sixers"), old names ("Bombay", "Cleveland Indians"), abbreviations ("FDR", "DRC").
- **Short forms with a prefix:** "LA Lakers", "NY Yankees", "OKC Thunder". The game won't guess
  that "LA" means Los Angeles.
- **Sequels by number** when people use them: "Avengers 3" for Infinity War.

Leave out short forms that could mean two answers. If "Roosevelt" could mean #1 or #13, accept it
for neither; the import stops you if you try.

[`apps/server/test/typo-corpus.ts`](../apps/server/test/typo-corpus.ts) holds about 150 real-world
misspellings and wrong-but-similar answers for the starter questions. `bun run test` checks every
one, so run it after changing the matching rules.

## What makes a good question

The game punishes players for being wrong, so the answer list has to be beyond argument.

- **Strict, unambiguous ranking.** "Highest mountains" works. "Best movies" doesn't. The first
  version of "longest-serving US presidents" had twelve presidents tied at exactly eight years, so
  Reagan scored +10 while Obama, with the identical record, got −5. Questions like that were
  replaced.
- **No tie straddling the cutoff.** Ties *inside* the top section only nudge the points around, and
  ties in the tension zone don't matter because every tension answer costs the same. A tie across
  the cutoff is unfair. Change the cutoff to step around it, and say so in the question: "Top 8 NBA
  franchises by championships" exists because four teams tie for 9th place.
- **Break ties the same way every time, and say how.** The starter sports questions rank tied
  teams by who reached the total first, and note that in `source`.
- **Pin anything that changes.** Box office records, championships and populations go out of
  date. Put the cut-off date in the question: "(through 2025)", "(as of the end of 2023)".

## How questions are picked

When a game starts, the server takes every active, playable question from the categories the
host selected. It draws the least-played ones first, choosing at random among equals, then
increments each drawn question's `usage_count`. With a small pool, players see every question
before any of them repeats. If the selection has fewer questions than the requested number of
rounds, the game is shortened, and the setup screen says so in advance.
