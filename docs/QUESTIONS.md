# Writing questions

Questions come in **question packs**: JSON files you load with the import command. The bundled
question bank is the [`apps/server/data/`](../apps/server/data/) folder: the starter pack
`questions.json` plus one pack per topic in `packs/`. `bun run setup` and `bun run seed` import all
of it.

## The answer list

Each question has **one ranked list of answers, best first**. The list has two parts:

```
answers[0]  … answers[cutoff-1]    the top section: #1 scores 1 point, #2 scores 2, … #cutoff scores cutoff
the next 3, 4 or 5 entries         the tension zone: lurking just below the list, each costs −5
```

Anything else a player types costs −3, including real entries further down the ranking.

This follows the TENS10N show. Missing by a little (an answer just below the list) hurts more
than missing by a lot (−3), so the tension zone is a narrow band, never the rest of the ranking.
Before anyone answers, the game announces how many tension answers a question has ("there are
four tension answers here"), just like the show's host does.

- The **position** in the list is the rank. There's no `rank` field.
- Every question has **3 to 5 tension answers**: exactly the entries ranked just below the
  cutoff, in order. With the default cutoff of 10, that's **13–15 answers** in total; in general
  `cutoff + 3` to `cutoff + 5`. The import rejects anything else, and the game never draws a
  question with fewer than 3.
- Choose 3, 4 or 5 so the tension zone ends cleanly. If #15 and #16 have the same value, stop at
  #14.

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
| `answers`    | yes      | The ranked list described above: `cutoff + 3` to `cutoff + 5` entries.        |
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
bun run import data/packs --dry-run     # a folder imports every .json inside it, subfolders too
```

A question counts as existing when it has the same category and the same question text. If you
change a question's text, the import adds it as a new question. To retire the old version,
deactivate it in the question manager (below). Inactive questions and empty categories never
appear in the game.

### What the import checks

The import **rejects** a pack, naming the exact entry, when:

- a question doesn't have 3–5 tension answers (`cutoff + 3` to `cutoff + 5` answers in all);
- the `display` figures disagree with the ranking: when every answer has a number, they must run
  consistently from highest to lowest (or lowest to highest). Durations, dates, "$1.5B"-style
  amounts and scientific notation are understood;
- the figures show a tie between #cutoff and the next answer, so one would score and the other
  would cost 5. Show more precise figures if they really differ. A display that starts with a
  rank (`"#5 — 30 pts"`) is compared by that rank, so league positions split by goal difference
  pass even when the points are level;
- the question says "Top N" but the cutoff isn't N (for example "Top 8" with the default cutoff of 10);
- one spelling would match two different answers (for example `"roosevelt"` as an alias on both
  Roosevelts), or an answer has no letters or digits at all;
- a category path isn't made of lower-case slugs;
- a field name isn't recognised. Typos can't vanish silently: `"aliasses"` gets "Did you mean
  "aliases"?", and fields from the old format, such as `rank`, `points` or `questionText`, get an
  explanation of what to do instead.

It **warns**, but still imports, when two answers on one list look alike (say, "Phillips" and
"Philips", or the alias "Holland" next to "Poland"). Check that both really belong and that the
spellings are right. If they do, leave them: a typo is scored as whichever answer it is closer to,
so never drop a real alias just to silence the warning.

```
✗ my-pack.json is not a valid question pack:
✖ lists 18 answers, but a cutoff of 10 needs 13–15: the top 10 that score, then the 3–5 tension answers ranked just below them, and nothing deeper (a deeper answer should count as a plain miss)
  → at questions[3].answers
✖ is out of order: #6 Yenisey (20,000 m³/s) should come before #5 Paraná (18,000 m³/s) in a list that goes from highest to lowest. Reorder the answers or fix the figures
  → at questions[4].answers[5]
✖ "rank" isn't a field: answers are ranked by their order in the list, so remove "rank" and put them in order, #1 first
  → at questions[5].answers[0]
```

## Editing in the browser

The question manager at `/admin` is the quickest way to fix a typo, add an alias or retire a
question (see the [README](../README.md#the-question-manager) for the password). It writes
questions in the same shape as a pack and runs the same checks as the import, so a question
the import would reject can't be saved there either. Worth knowing:

- **Changes go into the database.** The pack files don't change. Use **Export** to download the
  filtered questions as a pack and copy the edits into `apps/server/data/`, or they're lost on
  `bun run db:reset`.
- **Answers are ranked by row order**, as in a pack. ↑ and ↓ move a row. The editor draws the
  cutoff line and counts the tension answers as you go. Pasting several lines into an answer box
  fills several rows, and lines copied from a spreadsheet as answer, tab, figure fill in the
  figures too.
- **Look-alike warnings don't block saving.** They're shown after saving, as the import shows
  them.
- **Questions that have been played can't be deleted**, because past games refer to them.
  Deactivate them instead.
- **Changing a question's text changes how packs recognise it.** If the original is still in a
  bundled pack, `bun run setup` imports it again as a separate question. Deactivate the new
  copy, or update the pack.

## Research tools

Two Python scripts (standard library only) make lists reproducible and checkable.

**`apps/server/scripts/wiki_tables.py`** reads the tables of a Wikipedia article exactly as
published, and ranks or filters them mechanically:

```bash
python3 apps/server/scripts/wiki_tables.py "List of U.S. states and territories by population"            # list tables
python3 apps/server/scripts/wiki_tables.py "List of U.S. states and territories by population" --table 1 --header-rows 2   # column names
python3 apps/server/scripts/wiki_tables.py "List of U.S. states and territories by population" --table 1 --header-rows 2 \
  --name State --value 2025 --where 'State~a$' --top 15                                                      # ranked + filtered
```

The ranking mode prints a **recipe** line such as
`https://en.wikipedia.org/w/index.php?oldid=1378210740 | table 1 | name: State | value: 2025 | header rows: 2 | where: State~a$`.
Put it in the question's `source`. It pins the exact revision and says how the list was built.
Filters (`--where`, repeatable) take `Column=text`, `Column!=text`, `Column~regex` or
`Column!~regex`, and can only use columns of that table. That's what keeps twist questions honest.
Use `--order asc` for "smallest", "earliest" or "fastest" lists. Numbers, money ("$2.92 billion"),
dates and clock times ("2:01:09") are understood, and so are thousands grouped with spaces or
dots ("16.308.946"). A few options cover awkward pages:

- `--table "4+5"` joins a ranking that the article splits across two tables (a Tour de France
  classification printed in two halves).
- `--value "#rows"` ranks names by how many rows they appear on (titles won, when the table lists
  one row per final).
- `--header-rows 0` reads a table that has no header row; pick its columns by number
  (`--name 2 --value 1`).

A rank cell that shows only a medal icon is read as its place (gold 1, silver 2, bronze 3).

**`apps/server/scripts/check_pack.py`** re-runs every recipe in a pack against its cited revision
and compares the result with the answers position by position, including the `display` figures:

```bash
python3 apps/server/scripts/check_pack.py apps/server/data/packs/us-states.json
✓ questions[0] Top 10 most populated US states (2025 estimate) (recipe reproduces all 15 answers)
✗ questions[4] … (recipe): #2 should be Florida (23,462,518), not Texas
```

For a question with only a plain Wikipedia link it falls back to finding the answers in the page's
tables, and warns when rows were skipped.

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

**3. Numbers and markers must agree.** Digits, number words and Roman numerals (I to LXXXIX) are
compared as numbers, and a fuzzy match is only allowed when they're identical. "Frozen 2", "Frozen
Two" and "Frozen II" all match Frozen II. "Star Wars 9" never matches "Star Wars 7", "Annapurna II"
never matches Annapurna, and "Top Gun" never matches "Top Gun 2". A one-letter numeral (I, V, X)
only counts as a number at the end of an answer, so "X-Men" and "I, Robot" keep their letters.
Direction and weekday words work the same way when both sides have one: "North Korea" is never
taken for South Korea, and "Monday Night Football" never for Sunday Night Football. A typo in the
word itself ("Sotuh Korea") still counts.

If two listed answers are equally close, the one that's closer as written wins, then the
higher-ranked one.

**Real answers are never typos.** When any question in the bank lists two look-alike spellings
as different answers, typing one of them exactly never counts as a typo of the other, on any
question. The Netherlands carries the alias "Holland", and medal tables list it beside Poland, so
"Poland" never scores as the Netherlands, even on a list Poland isn't on. Iceland and Ireland work the same way. The server builds this from the whole bank
and rebuilds it within a minute of an import.

### What still needs an alias

Matching works on spelling, not meaning. Add aliases for:

- **Different words for the same thing:** last names ("Lincoln"), nicknames ("Teddy Roosevelt",
  "Sixers"), old names ("Bombay", "Cleveland Indians"), abbreviations ("FDR", "DRC").
- **Short forms with a prefix:** "LA Lakers", "NY Yankees", "OKC Thunder". The game won't guess
  that "LA" means Los Angeles.
- **Sequels by number** when people use them: "Avengers 3" for Infinity War.

Leave out short forms that could mean two answers. If "Roosevelt" could mean #1 or #13, accept it
for neither; the import stops you if you try.

[`apps/server/test/typo-corpus.ts`](../apps/server/test/typo-corpus.ts) holds about 160 real-world
misspellings and wrong-but-similar answers for the starter questions. `bun run test` checks every
one, so run it after changing the matching rules.

## What makes a good question

The game punishes players for being wrong, so the answer list has to be beyond argument.

- **Every answer reproducible.** Build the list with `wiki_tables.py` and put its recipe in
  `source`, so `check_pack.py` can rebuild it. A list nobody can rebuild can't be checked.
- **A big pool.** There must be at least twice as many plausible answers as the list holds
  (cutoff plus tension answers). "The 10 most populous Canadian provinces" fails: there are only
  ten, so players would just name them all. Small fields get a smaller cutoff: a 16-team
  tournament supports a Top 5.
- **The party test.** People who follow the subject should know at least 3 of the top 5. A list
  of obscure names is a guessing game, not a gamble.
- **A cutoff of 7 to 10.** Use 5 or 6 only for small fields. When a source lists only its top 10,
  ask for the Top 7 and use #8–#10 as the tension zone.
- **Strict, unambiguous ranking.** "Highest mountains" works. "Best movies" doesn't. The first
  version of "longest-serving US presidents" had twelve presidents tied at exactly eight years, so
  Reagan scored +10 while Obama, with the identical record, got −5. Questions like that were
  replaced.
- **No tie straddling the cutoff.** Ties *inside* the top section only nudge the points around, and
  ties in the tension zone don't matter because every tension answer costs the same. A tie across
  the cutoff is unfair. Change the cutoff to step around it, and say so in the question: "Top 8 NBA
  franchises by championships" exists because four teams tie for 9th place.
- **Official placings aren't ties.** League positions, draft picks, standings and medal-table
  ranks are decided by the competition's own tiebreakers, so two clubs level on points are still
  #5 and #6. Display them as `"#5 — 30 pts"` and rank by the position column. Only a rank the
  source itself shares ("=8") is a tie. Votes and statistics are different: equal points really
  are a tie.
- **Break ties the same way every time, and say how.** The starter sports questions rank tied
  teams by who reached the total first, and note that in `source`.
- **Short names only when they're unique.** A surname alias ("Merckx") is fine when no other
  answer on that question shares it. Two Molinaris on one list get no "Molinari".
- **Series need variety.** A question asked once per season or edition ("final 1987 Serie A
  table", "1987 Tour de France") makes a good series, because each year's list is different. A
  ranking that barely changes year to year doesn't: keep editions a few years apart, and skip
  one whose list has the same members as the last.
- **Pin anything that changes.** Box office records, championships and populations go out of
  date. Put the cut-off date in the question: "(through 2025)", "(as of the end of 2023)".
- **Give it a twist.** The best TENS10N questions filter well-known data in a surprising way: "the
  10 most populated US states that end with an A", "the 10 highest Premier League goalscorers to
  have never won a Golden Boot", "the 10 most populous countries with a star on their flag". A
  twist turns an easy list into a gamble, but it has to be computed from the source data, not
  guessed.

## How questions are picked

When a game starts, the server takes every active, playable question from the categories the
host selected. It draws the least-played ones first, choosing at random among equals, then
increments each drawn question's `usage_count`. With a small pool, players see every question
before any of them repeats. If the selection has fewer questions than the requested number of
rounds, the game is shortened, and the setup screen says so in advance.
