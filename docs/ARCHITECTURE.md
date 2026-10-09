# Architecture

```
 host browser (TV) ─┐                          ┌──────────────── game server (Bun) ────────────────┐
                    │   HTTP  /api/*           │  Hono API ── RoomRegistry ── GameRoom (one per game)│
 phone browsers ────┼─────────────────────────▶│                                   │                 │
                    │   Socket.IO  /socket.io  │  Socket.IO handlers ──────────────┘                 │
                    └─────────────────────────▶│                         PrismaGameStore ── SQLite   │
                                               └─────────────────────────────────────────────────────┘
```

Game state lives in memory, in one `GameRoom` object per game. The server owns all of it. After any
change, it sends each connected browser a complete snapshot of the game. Browsers never merge partial
updates; they render the newest snapshot they have. Database writes happen behind the in-memory
state so that finished rounds survive a restart.

In development the Vite dev server (`:5173`) serves the UI and proxies `/api` and `/socket.io` to the
game server (`:3001`). In production, `bun run build` writes the web app into `apps/web/build/`, and
the game server serves those files itself. Everything then runs on one port.

## Server (`apps/server/src`)

| Module                 | Responsibility                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- |
| `index.ts`             | Reads `PORT`/`HOST`, starts the server, shuts down cleanly                        |
| `server.ts`            | Connects Hono, Socket.IO and static file serving onto one Node `http` server      |
| `http/api.ts`          | REST endpoints                                                                   |
| `game/room.ts`         | `GameRoom`: the game rules and state machine                                     |
| `game/registry.ts`     | Live rooms by join code, code generation, reloading rooms from the database, idle cleanup |
| `game/sockets.ts`      | Socket.IO events: payload validation, host/player identity, snapshot broadcasts  |
| `game/matching.ts`     | Answer normalization and fuzzy matching                                          |
| `game/store.ts`        | The `GameStore` persistence interface and its Prisma implementation              |
| `content/importer.ts`  | Question pack schema and the import into the database                            |

### Game lifecycle

```
 lobby ──start──▶ playing ──round ends──▶ reveal ──next──▶ playing … ──next after last round──▶ finished
```

- **lobby.** Players join with a name. Names must be unique within a game, ignoring case. The host
  can start once at least one player has joined. Starting draws the questions: the least-played
  questions in the selected categories come first, ties are broken at random, and the game is
  shortened if there aren't enough questions.
- **playing.** The question is shown and the clock runs. Phones send their answer as a *draft*
  while the player types (debounced) and a *lock* when they commit. A round ends when one of these
  happens:
  - every required player has locked in;
  - the timer runs out, plus a 1.5 s grace period so a phone that auto-locks at 0:00 still gets
    through;
  - the host clicks **End round now**.

  Required players means everyone, including disconnected players, until the host clicks
  **Stop waiting for offline players**. When a round ends, each player's latest draft or locked
  answer is scored.
- **reveal.** Scoring is synchronous. The full answer list goes out with who picked what, along with
  each player's result and new score. The answer key is never sent before this point.
- **finished.** Final standings. Players can still reconnect to see them.

`GameRoom` makes every state change synchronously. Socket events therefore can't interleave halfway
through a transition, so scoring can never run twice. Database writes go on a per-room promise
queue and run in order behind the in-memory state.

### Scoring

The rules live in `packages/shared/src/scoring.ts`, so the server and the UI can't disagree:

- rank ≤ cutoff → +rank
- rank > cutoff → −5 (tension)
- no match or blank → −3

A double multiplies the result by 2. A double is spent only when the player actually typed
something. Each question sets its own cutoff (default 10).

### Answer matching

`normalizeAnswer` transforms answers in this order:

1. Strip accents and lower-case the text.
2. Replace `&` with "and".
3. Drop apostrophes.
4. Turn other punctuation into spaces.
5. Remove a leading "the", "a" or "an".
6. Expand `mt` → `mount` and `st` → `saint`.
7. Turn number words one–ten into digits.

The comparison key is that result with spaces removed, so "Spider-Man", "spider man" and "Spiderman"
are all equal. A submission is matched like this:

1. **Exact.** If its key equals the key of the answer text or one of its aliases, that answer wins.
2. **Fuzzy.** Otherwise, each listed spelling is scored by the better of two similarities, written
   and sounded, and the best score wins if it reaches 0.8.
   - *Written* is optimal-string-alignment distance on the keys: an insertion, deletion,
     substitution, or swap of two neighbouring letters each counts as one edit.
   - *Sounded* is the same distance on `soundKey`, which applies a few English spelling
     equivalences per word (ph→f, soft c→s, hard c/ck/q→k, x→ks, z→s, y→i, a silent h after a
     consonant, and doubled letters collapsed).
3. **Numbers guard.** A fuzzy match is only considered if both sides contain the same numbers.
   `numbersIn` reads digits, number words and Roman numerals; a one-letter numeral counts only as
   the last word. This stops "Star Wars 9" from matching "Star Wars 7" or "Annapurna II" from
   matching "Annapurna".

Ties go to the better written score, then to the higher-ranked answer.

The importer refuses any question where one spelling could match two different answers exactly, and
warns when two answers are close enough to be fuzzily confused. `apps/server/test/typo-corpus.ts`
holds about 150 real misspellings and look-alike wrong answers for the starter questions, and the
test suite checks all of them.

### Identity and reconnecting

- **Host.** `POST /api/games` returns a random `hostToken` to the creating browser only. That
  browser keeps it in `localStorage` under the game code. `host:join` must present the token.
- **Players.** Each browser keeps a random `deviceId` in `localStorage`. Joining with a known
  `deviceId` reclaims the same seat, with score, doubles and the current round's draft intact.
  That's how refreshes, sleeping phones and dropped Wi-Fi recover.
- **Reconnects.** The web client remembers its seat. When Socket.IO reconnects, the client re-sends
  the join automatically, and the snapshot that follows restores the screen.

### Persistence and restarts

| When             | What gets written                                                           |
| ---------------- | --------------------------------------------------------------------------- |
| game created     | `games` row: code, host token, settings, selected categories                 |
| player joins     | `players` row (renames update it)                                            |
| game starts      | `game_questions` (the drawn questions, in order), `questions.usage_count`, status `active` |
| round starts     | `games.current_round`, `game_questions.asked_at`                              |
| round scored     | one `submissions` row per player; player scores and remaining doubles        |
| game finished    | status `completed`                                                          |

If a room isn't in memory, the next join for its code reloads it from the database. That happens
after a restart or after idle cleanup. A game that was `active` comes back parked in the reveal
phase after its last scored round, flagged as `resumed`. The host presses **Next round** to carry
on. A round that was still in progress when the server went down is replayed from the start.

Idle rooms are dropped from memory when nobody is connected to them: finished games after 30
minutes, any other game after 3 hours.

## Socket protocol

The types are in `packages/shared/src/protocol.ts`.

**Client → server**

| Event              | Payload                       | Who    | Ack                     |
| ------------------ | ----------------------------- | ------ | ----------------------- |
| `host:join`        | `{ code, token }`             | host   | `{ ok }` or `{ ok: false, error }` |
| `host:start`       | none                          | host   | `{ ok }` or `{ ok: false, error }` |
| `host:endRound`    | none                          | host   | none                    |
| `host:skipOffline` | none                          | host   | none                    |
| `host:next`        | none                          | host   | none                    |
| `player:join`      | `{ code, name, deviceId }`    | player | `{ ok, playerId }` or `{ ok: false, error }` |
| `player:draft`     | `{ answer, useDouble }`       | player | none                    |
| `player:lock`      | `{ answer, useDouble }`       | player | none                    |

**Server → client**

The server sends a single event, `state`, as `{ game: GameView, you: YouView | null }`:

- `game` is the same for everyone: phase, round, players with scores and status, the current
  question, `remainingMs`, and the reveal once there is one.
- `you` is the receiving player's private slice: their own draft, double choice and lock state. It
  is `null` on the host screen.

Clocks on phones can't be trusted, so the server sends `remainingMs` rather than a timestamp. The
client turns it into a local deadline when the snapshot arrives.

## HTTP API

| Method & path         | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `GET /api/health`     | `{ ok: true }`                                                         |
| `GET /api/info`       | `{ lanAddresses }`; the host screen uses these to build a join link phones can open |
| `GET /api/categories` | Category tree with `ownQuestions` and `totalQuestions`; empty categories are left out |
| `POST /api/games`     | `{ totalRounds, timePerRound, doublesPerPlayer, categoryIds }` → `{ code, hostToken }` |

Questions and answers are deliberately not available over HTTP, because that would hand players
the answer key. They are managed with the import CLI and Prisma Studio.

## Data model

SQLite through Prisma (`apps/server/prisma/schema.prisma`):

- `categories`: a tree. The `id` is the slash-separated path (`geography/mountains`).
- `questions`: question text, cutoff, difficulty, source, tags, `active`, `usage_count`.
- `answers`: rank, text, display value, aliases (a JSON array).
- `games`, `game_questions`, `players`, `submissions`: one game's settings, its drawn questions,
  its players, and every scored answer.

## Web app (`apps/web/src`)

| Route          | Screen                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `/`            | Home                                                                   |
| `/host`        | Create a game: categories (all selected by default) and settings        |
| `/host/[code]` | The TV screen: lobby with the join code, live round, reveal, final standings |
| `/join`        | Enter a code (or arrive with `?code=`) and a name                      |
| `/play/[code]` | The phone: answer, double, lock in, see your result                    |

- `lib/game.svelte.ts` holds the single Socket.IO connection and the latest snapshot as Svelte 5
  `$state`. It also handles automatic rejoin.
- `lib/storage.ts` wraps `localStorage` (device id, name, host tokens) and copes with storage being
  unavailable.
- Pages only render; every rule is enforced on the server.

## Tests (`apps/server/test`)

- `matching.test.ts`: normalization, edit distance, sound keys, the numbers guard, points.
- `typo-corpus.test.ts`: every case in `typo-corpus.ts` against the real starter questions.
- `room.test.ts`: the room state machine against an in-memory store. It covers joining rules,
  scoring, the timer, offline players, finishing, and restoring.
- `importer.test.ts`: question pack validation (tension zone, "Top N" vs cutoff, unknown fields,
  ambiguous and look-alike spellings), including the bundled pack.
- `server.test.ts`: a real server on a temporary SQLite database. It covers the HTTP API, two
  complete games over Socket.IO (one with a mid-round reconnect, one with a server restart between
  rounds) and static file serving.
