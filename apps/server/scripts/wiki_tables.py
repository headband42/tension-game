#!/usr/bin/env python3
"""Print the tables of a Wikipedia article exactly as published, for researching question packs.

    python3 apps/server/scripts/wiki_tables.py "List of rivers by length"
    python3 apps/server/scripts/wiki_tables.py "List of rivers by length" --table 1 --rows 40
    python3 apps/server/scripts/wiki_tables.py "https://en.wikipedia.org/w/index.php?oldid=1379231701"

Without --table it lists every table (caption, columns, row count) and the first rows of each.
The first line printed is a permanent link to the exact revision read; cite it as the `source`.
"""

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

USER_AGENT = "TensionTriviaResearch/1.0 (https://github.com/headband42/tension-game)"
SKIP_TAGS = {"style", "script"}


MEDAL_PLACES = {"gold": "1", "silver": "2", "bronze": "3"}


def medal_place(icons):
    """The place shown by a rank cell that holds only a medal icon: "1st place, gold medalist(s)" → "1"."""
    for alt in icons:
        place = re.match(r"\s*(\d+)(?:st|nd|rd|th) place\b", alt, re.I)
        if place:
            return place.group(1)
        medal = re.search(r"(gold|silver|bronze)[ _]medal", alt, re.I)
        if medal:
            return MEDAL_PLACES[medal.group(1).lower()]
    return ""


class TableParser(HTMLParser):
    """Collects every wikitable as a grid of cell strings, expanding rowspan/colspan."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []  # each: {"caption": str, "section": str, "rows": [[str]]}
        self.section = ""  # text of the most recent h2–h4 heading, e.g. "2025 statistics"
        self.heading = None
        self.stack = []  # open tables: {"caption", "rows", "pending", "row", "cell", "caption_open"}
        self.skip_depth = 0
        self.skip_tag_stack = []

    @staticmethod
    def _attrs(attrs):
        return {k: (v or "") for k, v in attrs}

    def handle_starttag(self, tag, attrs):
        a = self._attrs(attrs)
        if self.skip_depth:
            if tag in ("sup", "span", "style", "script"):
                self.skip_tag_stack.append(tag)
                self.skip_depth += 1
            return
        hidden = "display:none" in a.get("style", "").replace(" ", "")
        if tag in SKIP_TAGS or (tag == "sup" and "reference" in a.get("class", "")) or (
            tag == "span" and (hidden or "sortkey" in a.get("class", ""))
        ):
            self.skip_tag_stack.append(tag)
            self.skip_depth = 1
            return

        if tag in ("h2", "h3", "h4") and not self.stack:
            self.heading = []
            return
        if tag == "table":
            is_wiki = "wikitable" in a.get("class", "")
            self.stack.append({"wiki": is_wiki, "caption": "", "rows": [], "pending": {}, "row": None, "cell": None, "caption_open": False})
            return
        if not self.stack:
            return
        t = self.stack[-1]
        if tag == "caption":
            t["caption_open"] = True
        elif tag == "tr":
            t["row"] = []
            t["col"] = 0
            t["row_has_td"] = False
            t["row_medals"] = []  # (column, place) of icon-only header cells, kept if this is a body row
        elif tag in ("td", "th") and t["row"] is not None:
            t["row_has_td"] = t["row_has_td"] or tag == "td"
            t["cell"] = {"text": [], "header": tag == "th", "rowspan": int(re.sub(r"\D", "", a.get("rowspan", "1")) or 1), "colspan": int(re.sub(r"\D", "", a.get("colspan", "1")) or 1)}
        elif tag == "br":
            self._text(" ")
        elif tag == "img" and t["cell"] is not None:
            # The alt text, or failing that the file name ("Gold_medal_icon.svg"), says which medal.
            t["cell"].setdefault("icons", []).append(f'{a.get("alt", "")} {a.get("src", "").rsplit("/", 1)[-1]}')
        elif tag == "sup" and t["cell"] is not None and "".join(t["cell"]["text"]).rstrip().endswith("10"):
            self._text("^")  # 8.6×10<sup>10</sup> → "8.6×10^10", not "8.6×1010"

    def handle_endtag(self, tag):
        if self.skip_depth:
            if self.skip_tag_stack and self.skip_tag_stack[-1] == tag:
                self.skip_tag_stack.pop()
                self.skip_depth -= 1
            return
        if tag in ("h2", "h3", "h4") and self.heading is not None:
            self.section = re.sub(r"\s+", " ", "".join(self.heading)).strip()
            self.heading = None
            return
        if not self.stack:
            return
        t = self.stack[-1]
        if tag == "table":
            done = self.stack.pop()
            if done["wiki"]:
                self.tables.append({"caption": done["caption"].strip(), "section": self.section, "rows": done["rows"]})
            elif self.stack and self.stack[-1]["cell"] is not None:
                # A layout table nested in a cell: fold its text into the outer cell.
                self.stack[-1]["cell"]["text"].append(" ".join(" ".join(r) for r in done["rows"]))
        elif tag == "caption":
            t["caption_open"] = False
        elif tag in ("td", "th") and t["cell"] is not None:
            self._place_cell(t)
        elif tag == "tr" and t["row"] is not None:
            self._fill_pending(t, until=None)
            if t["row_has_td"]:
                for col, place in t["row_medals"]:
                    if col < len(t["row"]) and not t["row"][col]:
                        t["row"][col] = place
            if any(cell for cell in t["row"]):
                t["rows"].append(t["row"])
            t["row"] = None
            # Age rowspans by one row.
            t["pending"] = {c: (text, n - 1) for c, (text, n) in t["pending"].items() if n - 1 > 0}

    def _fill_pending(self, t, until):
        while t["col"] in t["pending"] and (until is None or True):
            text, _ = t["pending"][t["col"]]
            t["row"].append(text)
            t["col"] += 1
            if until is not None:
                break

    def _place_cell(self, t):
        cell = t["cell"]
        t["cell"] = None
        while t["col"] in t["pending"]:
            t["row"].append(t["pending"][t["col"]][0])
            t["col"] += 1
        text = re.sub(r"\s+", " ", "".join(cell["text"])).strip()
        place = "" if text else medal_place(cell.get("icons", []))
        if place and cell["header"]:
            # A medal icon in a header row names a column (gold, silver, bronze); in a body row's
            # row-header cell it is the place. Which one is known when the row ends.
            t["row_medals"] += [(t["col"] + k, place) for k in range(cell["colspan"])]
        elif place:
            text = place
        for _ in range(cell["colspan"]):
            t["row"].append(text)
            if cell["rowspan"] > 1:
                t["pending"][t["col"]] = (text, cell["rowspan"])
            t["col"] += 1

    def _text(self, data):
        if not self.stack:
            return
        t = self.stack[-1]
        if t["cell"] is not None:
            t["cell"]["text"].append(data)
        elif t["caption_open"]:
            t["caption"] += data

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.heading is not None and not self.stack:
            self.heading.append(data)
            return
        self._text(data)


CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "tension-wiki")
TITLE_CACHE_SECONDS = 6 * 3600  # an article title resolves to a new revision only when someone edits it


def _cache_path(key):
    return os.path.join(CACHE_DIR, hashlib.sha256(key.encode()).hexdigest() + ".json")


def _request(params):
    """GET the MediaWiki API, retrying with backoff on rate limits and server errors."""
    url = f"https://en.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    delay = 2.0
    for attempt in range(8):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 7:
                raise
            retry_after = error.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
        except (urllib.error.URLError, TimeoutError):
            if attempt == 7:
                raise
            wait = delay
        time.sleep(wait + random.uniform(0, 1))
        delay = min(delay * 2, 60)
    raise RuntimeError("unreachable")


def fetch(title=None, oldid=None):
    """Parses an article by title (latest revision) or an exact revision by oldid.

    Results are cached on disk: an exact revision never changes, and a title is
    re-resolved after a few hours. This keeps many researchers from hammering Wikipedia."""
    key = f"oldid:{oldid}" if oldid else f"title:{title}"
    path = _cache_path(key)
    try:
        if os.path.exists(path) and (oldid or time.time() - os.path.getmtime(path) < TITLE_CACHE_SECONDS):
            with open(path, encoding="utf-8") as cached:
                return json.load(cached)
    except (OSError, ValueError):
        pass

    query = {"action": "parse", "prop": "text|revid|displaytitle", "format": "json", "formatversion": 2}
    query.update({"oldid": oldid} if oldid else {"page": title, "redirects": 1})
    data = _request(query)
    if "error" in data:
        sys.exit(f"Wikipedia: {data['error'].get('info', data['error'])}")
    page = data["parse"]

    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        for cache_key in {key, f"oldid:{page['revid']}"}:
            tmp = _cache_path(cache_key) + f".{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as out:
                json.dump(page, out)
            os.replace(tmp, _cache_path(cache_key))
    except OSError:
        pass
    return page


DOUBT = re.compile(r"citation needed|failed verification|dubious|unreliable source|better source needed|disputed", re.I)
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DURATION_SECONDS = {"yea": 31557600, "yr": 31557600, "mon": 2629800, "wee": 604800, "day": 86400, "hou": 3600, "hr": 3600, "min": 60, "sec": 1}
MULTIPLIERS = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12, "thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}


def value_of(cell):
    """The number a table cell stands for: "39,355,309" → 39355309, "$2.92 billion" → 2.92e9,
    "December 7, 1787" → 17871207. None when the cell has no number."""
    text = re.sub(r"\[[^\]]*\]", "", cell).replace("−", "-").replace("–", "-")
    # "4 382" or "4\u00a0382": thousands grouped with a space instead of a comma.
    text = re.sub(r"(?<=\d)[ \u00a0\u2009\u202f](?=\d{3}(?!\d))", ",", text)
    # "16.308.946": thousands grouped with dots. Two or more groups, so "1.234" stays a decimal.
    text = re.sub(r"\b\d{1,3}(?:\.\d{3}){2,}\b", lambda m: m.group(0).replace(".", ","), text)
    # "4,067,400 (June 2025)": a bracketed note is never the value when there's a number outside it.
    outside = re.sub(r"\([^)]*\)", " ", text)
    if re.search(r"\d", outside):
        text = outside
    rank = re.match(r"\s*#(\d+)\b", text)
    if rank:  # "#4 — 10 Years by Daði og Gagnamagnið": a leading rank is the value, whatever follows it
        return int(rank.group(1))
    clock = re.search(r"\b(\d+):(\d{2}(?:\.\d+)?)(?::(\d{2}(?:\.\d+)?))?", text)
    if clock:  # "2:01:09" → seconds; "1:43.40" (min:sec.hundredths) → seconds
        a, b, c = clock.group(1), clock.group(2), clock.group(3)
        return int(a) * 3600 + float(b) * 60 + float(c) if c else int(a) * 60 + float(b)
    iso = re.search(r"\b(1\d{3}|20\d{2})-(\d{2})-(\d{2})\b", text)
    if iso:  # "1885-11-25"
        return int(iso.group(1)) * 10000 + int(iso.group(2)) * 100 + int(iso.group(3))
    # "December 7, 1787", "7 December 1787", "Dec. 1787" — the month must sit next to the year,
    # so a name like "Martin Van Buren" in the same cell is never read as March.
    date = re.search(rf"\b(?:([0-3]?\d)(?:st|nd|rd|th)?\s+)?{MONTH}\.?(?:\s+([0-3]?\d)(?:st|nd|rd|th)?)?,?\s+(1\d{{3}}|20\d{{2}})\b", text, re.I)
    if date:
        month = MONTHS.index(date.group(2)[:3].lower()) + 1
        day = date.group(1) or date.group(3)
        return int(date.group(4)) * 10000 + month * 100 + (int(day) if day else 0)
    durations = re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*(years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b", text, re.I)
    if durations:  # "57 years, 67 days" → seconds, so mixed units sort correctly
        return sum(float(n.replace(",", "")) * DURATION_SECONDS[u.lower().rstrip("s")[:3]] for n, u in durations)
    sci = re.search(r"(-?\d+(?:\.\d+)?)\s*[×x]\s*10\^(-?\d+)", text)
    if sci:  # "8.6×10^10" (superscript exponents are marked with ^ by the parser)
        return float(sci.group(1)) * 10 ** int(sci.group(2))
    number = re.search(r"(-?\d[\d,]*(?:\.\d+)?)\s*(?:([KMBT])\b|(thousand|million|billion|trillion)\b)?", text)
    if not number:
        return None
    value = float(number.group(1).replace(",", ""))
    return value * MULTIPLIERS.get(number.group(2) or number.group(3) or "", 1)


def find_column(header, wanted):
    """A column by (case-insensitive) header text, or by 1-based number if no header matches."""
    wanted = str(wanted).strip().lower()
    for i, name in enumerate(header):
        if name.strip().lower() == wanted:
            return i
    matches = [i for i, name in enumerate(header) if wanted in name.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches and wanted.isdigit() and 1 <= int(wanted) <= len(header):
        return int(wanted) - 1
    raise SystemExit(f"Column {wanted!r} is {'ambiguous' if matches else 'not found'}; columns: " + ", ".join(f"{i + 1}={h}" for i, h in enumerate(header)))


def headers(table, header_rows=1):
    """Column names, joining stacked header rows: "Census population / July 1, 2025 (est.)".
    A table with no header row (header_rows 0) has unnamed columns: pick them by number."""
    if header_rows == 0:
        return [""] * max((len(r) for r in table["rows"]), default=0)
    width = max(len(r) for r in table["rows"][:header_rows])
    names = []
    for col in range(width):
        parts = []
        for row in table["rows"][:header_rows]:
            cell = row[col].strip() if col < len(row) else ""
            if cell and cell not in parts:
                parts.append(cell)
        names.append(" / ".join(parts))
    return names


COUNT_ROWS = "#rows"


def rank(table, name, value, where=(), order="desc", header_rows=1):
    """Ranks a table's rows by one column, after filters like "Continent=Africa", "State~a$"
    (regex) or "Coast!~yes" (negated regex). Rows whose value isn't a number are dropped.
    With value "#rows", ranks each name by how many rows it appears on (titles won, times hosted)."""
    header = headers(table, header_rows)
    counting = value.strip().lower() == COUNT_ROWS
    name_col = find_column(header, name)
    value_col = name_col if counting else find_column(header, value)
    filters = []
    for condition in where:
        m = re.match(r"^(.+?)(!~|~|!=|=)(.*)$", condition)
        if not m:
            raise SystemExit(f"Bad filter {condition!r}: use Column=text, Column!=text, Column~regex or Column!~regex")
        filters.append((find_column(header, m.group(1)), m.group(2), m.group(3)))

    def keep(row):
        for col, op, arg in filters:
            cell = row[col] if col < len(row) else ""
            hit = re.search(arg, cell, re.I) is not None if "~" in op else cell.strip().lower() == arg.strip().lower()
            if hit == op.startswith("!"):
                return False
        return True

    rows = []
    for row in table["rows"][header_rows:]:
        if max(name_col, value_col) >= len(row) or not keep(row):
            continue
        if name_col != value_col and row[name_col] == row[value_col]:
            continue  # one cell spanning the row: a footer ("Last updated: …") or a section heading
        v = value_of(row[value_col])
        label = re.sub(r"\[[^\]]*\]", "", row[name_col]).strip()
        label = re.sub(r"\s*\(\d+\)$", "", label)  # "Neymar (2)": the table's count of repeat rows
        if counting and label:
            rows.append((label, None, None))
        elif v is not None and label:
            rows.append((label, row[value_col], v))
    if counting:
        counts = {}
        for label, _, _ in rows:
            counts[label] = counts.get(label, 0) + 1
        rows = [(label, f"{n} rows", n) for label, n in counts.items()]
    rows.sort(key=lambda r: r[2], reverse=(order == "desc"))
    # A name on several rows (a PM's separate terms, a player's seasons) counts once, at its best row.
    ranked, seen = [], set()
    for r in rows:
        if r[0] not in seen:
            seen.add(r[0])
            ranked.append(r)
    return ranked


def pick_table(tables, spec, header_rows=1):
    """The table a recipe names: "4", or "4+5" for one ranking that Wikipedia splits across
    tables (#1–10 in one, #11 onward in the next). The later tables must have the same columns;
    a repeated header row is dropped."""
    try:
        numbers = [int(n) for n in str(spec).split("+")]
    except ValueError:
        raise SystemExit(f'Bad table {spec!r}: use a number, or numbers joined by + ("4+5")')
    for n in numbers:
        if not 1 <= n <= len(tables):
            raise SystemExit(f"There is no table {n}: the page has {len(tables)}")
    first = tables[numbers[0] - 1]
    if len(numbers) == 1:
        return first
    head = first["rows"][:header_rows]
    width = len(headers(first, header_rows))
    rows = list(first["rows"])
    for n in numbers[1:]:
        more = list(tables[n - 1]["rows"])
        # Drop the continuation's own caption row ("(11–150)" spanning every column) and repeated header.
        while more and (len(set(more[0])) == 1 or more[0] in head):
            more.pop(0)
        if any(len(row) != width for row in more):
            raise SystemExit(f"Table {n} doesn't have the same columns as table {numbers[0]}, so they can't be joined")
        rows += more
    return {**first, "rows": rows}


def recipe(source, table_index, args):
    parts = [source, f"table {table_index}", f"name: {args.name}", f"value: {args.value}"]
    if args.header_rows != 1:
        parts.append(f"header rows: {args.header_rows}")
    parts += [f"where: {w}" for w in args.where]
    if args.order != "desc":
        parts.append(f"order: {args.order}")
    return " | ".join(parts)


def parse_tables(html):
    parser = TableParser()
    parser.feed(html)
    return parser.tables


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("title", help='article title, article URL, or a permanent oldid link')
    parser.add_argument("--table", help='print only this table (numbered from 1); "4+5" joins a ranking split across two tables')
    parser.add_argument("--rows", type=int, default=25, help="rows to print per table (default 25)")
    ranking = parser.add_argument_group("ranking (needs --table)", "rank a table's rows by one column, optionally filtered")
    ranking.add_argument("--name", help="column holding the answers (header text or number)")
    ranking.add_argument("--value", help=f'column to rank by, or "{COUNT_ROWS}" to rank names by how many rows they appear on')
    ranking.add_argument("--where", action="append", default=[], help='filter, repeatable: "Continent=Africa", "State~a$", "Coast!~yes"')
    ranking.add_argument("--order", choices=["desc", "asc"], default="desc", help="desc = biggest first (default); asc = smallest or earliest first")
    ranking.add_argument("--top", type=int, default=20, help="how many ranked rows to print (default 20)")
    ranking.add_argument("--header-rows", type=int, default=1, help="how many rows at the top are headers (default 1; 0 for a table with none, then pick columns by number)")
    args = parser.parse_args()

    title = args.title
    oldid = re.search(r"oldid=(\d+)", title)
    if oldid:
        page = fetch(oldid=oldid.group(1))
    else:
        if title.startswith("http"):
            title = urllib.parse.unquote(title.rstrip("/").split("/wiki/")[-1]).replace("_", " ")
        page = fetch(title=title)
    print(f"Source: https://en.wikipedia.org/w/index.php?oldid={page['revid']}  ({page['title']})")
    tables = parse_tables(page["text"])
    if not tables:
        print("No wikitables on this page.")
        return

    if args.name or args.value:
        if not (args.table and args.name and args.value):
            raise SystemExit("Ranking needs --table, --name and --value.")
        table = pick_table(tables, args.table, args.header_rows)
        ranked = rank(table, args.name, args.value, args.where, args.order, args.header_rows)
        source = f"https://en.wikipedia.org/w/index.php?oldid={page['revid']}"
        print(f"Recipe (put this whole line in `source`):\n  {recipe(source, args.table, args)}\n")
        for i, (label, shown, _) in enumerate(ranked[: args.top], start=1):
            print(f"{i:3}. {label} | {shown}")
        if len(ranked) > args.top:
            print(f"... {len(ranked) - args.top} more")
        name_col = find_column(headers(table, args.header_rows), args.name)
        top = {label for label, _, _ in ranked[: args.top]}
        flagged = [
            re.sub(r"\[[^\]]*\]", "", row[name_col]).strip()
            for row in table["rows"][args.header_rows :]
            if name_col < len(row) and re.sub(r"\[[^\]]*\]", "", row[name_col]).strip() in top and any(DOUBT.search(c) for c in row)
        ]
        if any(DOUBT.search(h) for h in headers(table, args.header_rows)):
            flagged.insert(0, "(a column header)")
        if flagged:
            print(f"\n⚠ Wikipedia marks these rows as unsourced or doubtful: {', '.join(flagged)}. Don't use this list unless another table backs it up.")
        return

    shown_tables = [(args.table, pick_table(tables, args.table, args.header_rows))] if args.table else list(enumerate(tables, start=1))
    for i, table in shown_tables:
        rows = table["rows"]
        section = f"  [section: {table['section']}]" if table.get("section") else ""
        print(f"\n=== Table {i}: {table['caption'] or '(no caption)'} — {len(rows)} rows{section}")
        if args.table:
            print("Columns: " + ", ".join(f"{n + 1}={h}" for n, h in enumerate(headers(table, args.header_rows))))
        for row in rows[: args.rows if args.table else min(args.rows, 8)]:
            print(" | ".join(row))
        shown = args.rows if args.table else min(args.rows, 8)
        if len(rows) > shown:
            print(f"... {len(rows) - shown} more rows (use --table {i} --rows N)")


if __name__ == "__main__":
    main()
