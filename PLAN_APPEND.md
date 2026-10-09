
---

## 9. IMPLEMENTATION TASKS

### Phase 1: Foundation (Priority: HIGH)
- [ ] Set up project structure and repo
- [ ] Initialize database schema (SQLite/PostgreSQL)
- [ ] Create base models and schemas
- [ ] Set up Express/Hono backend
- [ ] Set up Socket.io for real-time
- [ ] Create basic frontend skeleton (React/Svelte)
- [ ] Configure development environment (hot reload, etc.)

### Phase 2: Core Game Logic (Priority: HIGH)
- [ ] Implement category hierarchy (tree structure)
- [ ] Implement question/answer CRUD
- [ ] Build answer matching algorithm
- [ ] Create fuzzy matching with Levenshtein
- [ ] Implement scoring system
- [ ] Build bulk import script (JSON)

### Phase 3: Game Flow (Priority: HIGH)
- [ ] Host setup screen (category selection)
- [ ] Game code generation and joining
- [ ] Player connection management
- [ ] Question display with timer
- [ ] Answer submission and locking
- [ ] Auto-advance reveal screen
- [ ] Leaderboard/score tracking
- [ ] Double mechanic implementation

### Phase 4: Phone UI (Priority: MEDIUM)
- [ ] Mobile-responsive join screen
- [ ] Real-time answer input
- [ ] Lock in button state
- [ ] Double toggle
- [ ] Connection status indicator
- [ ] Disconnected/rejoin flow

### Phase 5: Polish (Priority: MEDIUM)
- [ ] Bulk import CSV support
- [ ] Submitter tracking display
- [ ] Question stats (usage count)
- [ ] Game session persistence
- [ ] Error handling and validation

### Phase 6: Nice-to-Haves (Priority: LOW)
- [ ] Click-to-advance reveal option
- [ ] Bonus point for first-lock variant
- [ ] Multiple doubles per player config
- [ ] Session history/leaderboards
- [ ] Spectator mode (no answering)

---

## 10. TECHNICAL ARCHITECTURE

### Stack Recommendation

```
Backend:     Bun + Hono + Socket.io
Database:    SQLite (development) / PostgreSQL (production)
Frontend:    SvelteKit + TailwindCSS
Real-time:   Socket.io (WebSockets)
Build:       Vite (frontend), Bun (backend)
```

### Directory Structure

```
tension-game/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── models/
│   │   │   ├── services/
│   │   │   └── socket/
│   │   ├── prisma/
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── routes/
│       │   ├── components/
│       │   ├── stores/
│       │   └── lib/
│       └── package.json
│
├── packages/
│   └── shared/           # Shared types/schemas
│
├── tools/
│   └── importer/         # Bulk import CLI
│
└── docs/
    ├── SPEC.md
    └── PLAN.md
```

### Socket Events

```javascript
// Host events
"game:create"      -> { settings }
"game:start"       -> { gameId }
"game:nextRound"   -> { gameId }
"game:reveal"      -> { gameId, round }
"game:end"         -> { gameId }

// Player events
"player:join"      -> { code, name, deviceId }
"player:submit"    -> { gameId, answer, useDouble }
"player:lock"      -> { gameId }
"player:reconnect" -> { gameId, playerId }

// Server broadcasts
"game:state"       <- { status, players, currentRound }
"round:start"      <- { question, timer }
"round:update"     <- { locked, status }
"round:reveal"     <- { results, leaderboard }
"player:joined"    <- { id, name, score }
"player:left"      <- { id }
```

### State Management

- **Server:** In-memory game state (Redis for production)
- **Client:** Svelte stores for local UI state
- **Sync:** Socket.io broadcasts state changes

---

## 11. SAMPLE DATA

### Sample Categories

```json
{
  "categories": [
    { "id": "geography", "name": "Geography", "depth": 0 },
    { "id": "geography/mountains", "name": "Mountains", "parent": "geography", "depth": 1 },
    { "id": "geography/mountains/world", "name": "World's Highest", "parent": "geography/mountains", "depth": 2 },
    { "id": "geography/cities", "name": "Cities", "parent": "geography", "depth": 1 },
    { "id": "sports", "name": "Sports", "depth": 0 },
    { "id": "sports/baseball", "name": "Baseball", "parent": "sports", "depth": 1 },
    { "id": "sports/baseball/mlb", "name": "MLB", "parent": "sports/baseball", "depth": 2 }
  ]
}
```

### Sample Question

```json
{
  "category": "geography/mountains/world",
  "difficulty": 1,
  "question": "Top 10 highest mountains in the world",
  "tension_cutoff": 10,
  "submitter": "leeroy",
  "source": "wikipedia",
  "tags": ["geography", "mountains", "highest"],
  "answers": [
    { "rank": 1, "answer": "Mount Everest", "display": "8,849m", "aliases": ["everest", "sagarmatha", "chomolungma"] },
    { "rank": 2, "answer": "K2", "display": "8,611m" },
    { "rank": 3, "answer": "Kangchenjunga", "display": "8,586m", "aliases": ["kanchenjunga"] },
    { "rank": 4, "answer": "Lhotse", "display": "8,516m" },
    { "rank": 5, "answer": "Makalu", "display": "8,485m" },
    { "rank": 6, "answer": "Cho Oyu", "display": "8,188m" },
    { "rank": 7, "answer": "Dhaulagiri", "display": "8,167m" },
    { "rank": 8, "answer": "Manaslu", "display": "8,163m" },
    { "rank": 9, "answer": "Nanga Parbat", "display": "8,126m" },
    { "rank": 10, "answer": "Annapurna", "display": "8,091m" }
  ]
}
```

---

## 12. FUTURE WORK

### Game Modes
- **Turn-based:** Head-to-head duels with category blocking
- **Team mode:** Two teams, couch vs phones
- **Sabotage rounds:** Freeze opponents, steal points
- **Speed rounds:** Shorter timers, rapid-fire

### Features
- **Custom question packs:** User-created categories
- **Community submissions:** Submit and verify questions
- **Session replays:** Export and watch games
- **Achievements:** "Tension Master", "Risk Taker", etc.
- **Themes:** Visual themes beyond default
- **Sound effects:** Drum rolls, tension SFX

### Advanced Configuration
- Click-to-advance reveal (vs auto)
- First-to-lock bonus point
- Multiple doubles per player
- Adjustable tension cutoff (top 5, 20, etc.)
- Custom point values
- Custom penalties

### Platform
- Mobile app (Capacitor/React Native)
- Offline mode (local WiFi only)
- Cloud hosting option
- Internationalization (i18n)

---

## 13. OPEN QUESTIONS RESOLVED

| Question | Resolution |
|----------|------------|
| Duplicate answers? | Both get points by default. Future: first-lock bonus |
| Reveal pacing? | Auto-advance default. Future: click-to-advance option |
| Turn-based vs real-time? | Real-time for MVP. Turn-based in future work |
| Rejoin/disconnect? | Host toggle: wait OR continue |
| Subcategories? | Hierarchical tree system with path-based IDs |
| First-lock bonus? | Advanced option (currently: simple duplicates) |

---

*Document complete. Ready for implementation.*

