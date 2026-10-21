#!/usr/bin/env python3
"""Cross-checks a question pack against the Wikipedia revisions it cites.

    python3 apps/server/scripts/check_pack.py apps/server/data/packs/geography-water.json

For each question whose `source` contains a Wikipedia link (ideally a permanent
https://en.wikipedia.org/w/index.php?oldid=… link), it re-reads that page and
checks that every answer appears in one of its tables, in the same order as the
pack. It also warns when source rows are skipped between answers: a plain list
must use consecutive rows, while a filtered "twist" question ("...that end with
an A") skips rows on purpose. It can't judge the twist itself: that's on you.
"""

import json
import re
import sys
import unicodedata
import urllib.parse

from wiki_tables import fetch, parse_tables, pick_table, rank, value_of


# Letters NFKD doesn't split into base letter + accent (matches matching.ts).
UNSPLIT_LETTERS = str.maketrans({"đ": "d", "ð": "d", "ħ": "h", "ı": "i", "ł": "l", "ø": "o", "œ": "oe", "æ": "ae", "ß": "ss", "þ": "th"})


# Titles made only of symbols, spelled the way the answers spell them: Ed Sheeran's "÷" is "Divide".
SYMBOL_WORDS = {"+": "plus", "-": "subtract", "−": "subtract", "×": "multiply", "÷": "divide", "=": "equals", "★": "blackstar", "?": "questionmark"}


def key(text):
    if not re.search(r"\w", text) and text.strip():
        text = "".join(SYMBOL_WORDS.get(c, c) for c in text.strip())
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("&", "and")
    text = text.translate(UNSPLIT_LETTERS)
    text = re.sub(r"['’‘`\"“”]", "", text)  # quotes too: a cell can be '"The Box"'
    text = re.sub(r"^(the|a|an)\s+", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def cell_match(cell, spellings):
    """2 = the cell is exactly an accepted spelling, 1 = it starts with or contains one, 0 = neither."""
    best = 0
    for spelling in spellings:
        if not spelling:
            continue
        if cell == spelling:
            return 2
        if cell.startswith(spelling) or (len(spelling) >= 4 and spelling in cell):
            best = 1
    return best


def locate(answers, tables):
    """Finds the table column holding the most answers, and each answer's row in it.

    Matching within one column keeps "Nile" from matching another river's Outflow cell.
    """
    best = None
    for t_index, table in enumerate(tables, start=1):
        rows = [[key(cell) for cell in row] for row in table["rows"]]
        width = max((len(r) for r in rows), default=0)
        for column in range(width):
            cells = [r[column] if column < len(r) else "" for r in rows]
            positions = []
            for answer in answers:
                spellings = [key(answer["answer"])] + [key(a) for a in answer.get("aliases", [])]
                scores = [cell_match(c, spellings) for c in cells]
                exact = [i for i, score in enumerate(scores) if score == 2]
                loose = [i for i, score in enumerate(scores) if score == 1]
                positions.append(exact[0] if exact else loose[0] if loose else None)
            found = sum(p is not None for p in positions)
            if best is None or found > best[1]:
                best = (t_index, found, positions)
    return best


def parse_recipe(source):
    """Reads a ranking recipe written by wiki_tables.py:
    "<oldid link> | table 1 | name: State | value: 2025 | header rows: 2 | where: State~a$ | order: asc"."""
    parts = [p.strip() for p in (source or "").split(" | ")]
    table = next((p for p in parts if re.fullmatch(r"table \d+(\+\d+)*", p)), None)
    fields = {}
    where = []
    for p in parts:
        m = re.match(r"^(name|value|header rows|where|order):\s*(.*)$", p)
        if m:
            if m.group(1) == "where":
                where.append(m.group(2))
            else:
                fields[m.group(1)] = m.group(2)
    if not table or "name" not in fields or "value" not in fields:
        return None
    return {
        "table": table.split()[1],
        "name": fields["name"],
        "value": fields["value"],
        "header_rows": int(fields.get("header rows", 1)),
        "where": where,
        "order": fields.get("order", "desc"),
    }


def check_recipe(q, recipe, tables):
    """Recomputes the ranked list and compares it with the answers, position by position."""
    try:
        ranked = rank(pick_table(tables, recipe["table"], recipe["header_rows"]), recipe["name"], recipe["value"], recipe["where"], recipe["order"], recipe["header_rows"])
    except SystemExit as error:
        return [f"recipe failed: {error}"]
    issues = []
    for i, answer in enumerate(q["answers"]):
        if i >= len(ranked):
            issues.append(f"#{i + 1} {answer['answer']}: the recipe only yields {len(ranked)} rows")
            break
        spellings = [key(answer["answer"])] + [key(a) for a in answer.get("aliases", [])]
        if not cell_match(key(ranked[i][0]), spellings):
            issues.append(f"#{i + 1} should be {ranked[i][0]} ({ranked[i][1]}), not {answer['answer']}")
            continue
        shown = value_of(answer.get("display", ""))
        actual = ranked[i][2]
        # A table headed "(millions)" or "(years)" holds 10.2 where the display can say "10.2 million"
        # or "84.7 years": compare the bare number too.
        bare = value_of(re.sub(r"(?i)\b(thousand|million|billion|trillion|years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b|(?<=\d)[KMBT]\b", "", answer.get("display", "")))
        close = lambda x: x is not None and abs(x - actual) <= abs(actual) * 0.01
        # A "(millions)" column holds 6,500 where the display can say "$6.5 billion".
        scaled = lambda x: x is not None and any(abs(x - actual * f) <= abs(actual * f) * 0.01 for f in (1e3, 1e6, 1e9))
        if shown is not None and actual and not (close(shown) or close(bare) or scaled(shown)):
            issues.append(f"#{i + 1} {answer['answer']} displays {answer['display']!r} but the table says {ranked[i][1]!r}")
    return issues


def source_page(source):
    oldid = re.search(r"oldid=(\d+)", source or "")
    if oldid:
        return {"oldid": oldid.group(1)}
    title = re.search(r"wikipedia\.org/wiki/([^\s)#?]+)", source or "")
    if title:
        return {"title": urllib.parse.unquote(title.group(1)).replace("_", " ")}
    return None


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cache = {}
    problems = 0
    for path in sys.argv[1:]:
        pack = json.load(open(path, encoding="utf-8"))
        for n, q in enumerate(pack["questions"]):
            label = f"questions[{n}] {q['question']}"
            page_ref = source_page(q.get("source"))
            if not page_ref:
                print(f"? {label}: source is not a Wikipedia link, check it by hand")
                continue
            cache_key = json.dumps(page_ref, sort_keys=True)
            if cache_key not in cache:
                try:
                    cache[cache_key] = parse_tables(fetch(**page_ref)["text"])
                except Exception as error:  # network or missing page
                    cache[cache_key] = error
            tables = cache[cache_key]
            if isinstance(tables, Exception):
                print(f"✗ {label}: couldn't read the source ({tables})")
                problems += 1
                continue
            recipe = parse_recipe(q.get("source"))
            if recipe:
                issues = check_recipe(q, recipe, tables)
                if issues:
                    problems += 1
                    print(f"✗ {label} (recipe): " + "; ".join(issues))
                else:
                    print(f"✓ {label} (recipe reproduces all {len(q['answers'])} answers)")
                continue
            located = locate(q["answers"], tables)
            if not located or located[1] == 0:
                print(f"✗ {label}: none of the answers appear in the source's tables")
                problems += 1
                continue
            table, found, positions = located
            issues = [f"#{i + 1} {a['answer']} not found" for i, (a, p) in enumerate(zip(q["answers"], positions)) if p is None]
            seen = [(i, p) for i, p in enumerate(positions) if p is not None]
            for (i, p), (j, r) in zip(seen, seen[1:]):
                if r < p:
                    issues.append(f"#{j + 1} {q['answers'][j]['answer']} comes before #{i + 1} {q['answers'][i]['answer']} in the source")
            # Rows of the source between consecutive answers: an unfiltered list must have none,
            # or an entry was skipped and every rank below it is off by one.
            skips = [
                f"#{i + 1}→#{j + 1} skips {r - p - 1}"
                for (i, p), (j, r) in zip(seen, seen[1:])
                if r - p > 1
            ]
            skipped = f"; ⚠ source rows skipped: {', '.join(skips)} (only OK if the question filters the list)" if skips else ""
            if issues:
                problems += 1
                print(f"✗ {label} (table {table}): " + "; ".join(issues) + skipped)
            else:
                print(f"✓ {label} (table {table}, all {found} answers in order){skipped}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
