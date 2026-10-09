# Tension Game - Spec Document

## Status

🟡 **In Progress** — Core game mechanics implemented, running on ports 5173 (web) and 3001 (server)

### What's Working
- Real-time phone join via game codes
- Question reveal with countdown timer
- Answer submission and locking
- Double mechanic
- Answer matching with tension scoring

### What's Next
- Bulk question import
- Host dashboard improvements
- Reveal animations
- Sound effects

---

## Core Concept
Party game inspired by "Tension" (Top 10 countdown). Players answer from phones, main screen shows the drama.

---

## Scoring System

| Result | Points | Description |
|--------|--------|-------------|
| #1 Answer | 1 pt | Easiest, most obvious |
| #10 Answer | 10 pts | Hardest, most obscure (but still "known") |
| #11+ (Tension) | **-5 pts** | On the list, but past top 10 |
| Not on list | **-3 pts** | Valid guess, just not ranked |

**Example:** Top 10 highest mountains
- "Everest" → #1 → +1 point
- "Annapurna" → #10 → +10 points
- "Denali" → #20 → **-5 points** (TENSION!)
- "Mount Doom" → not on list → **-3 points**

---

## Double Mechanic

- **Default:** 1 double per player per game
- **Usage:** Applied after question reveal, before answering
- **Effect:** Points doubled (positive or negative)
- **Advanced config:** Allow 2+ doubles per game

---

## Game Flow

1. **Host Setup:**
   - Select categories (with checkbox)
   - See question count per category
   - Set round count (slider)
   - Set time limit per round (slider)
   - Optional: enable/disable doubles

2. **Question Phase:**
   - Category + question revealed to all
   - Players choose: use double now? (y/n)
   - Countdown begins

3. **Answer Phase:**
   - Real-time: everyone types simultaneously
   - Lock in answer (or auto-lock at timeout)

4. **Reveal Phase:**
   - Answers flip one-by-one (#1 → #10)
   - Points awarded with drama
   - Tension/penalty reveals last

---

## Database Schema

```
questions
├── id (primary key)
├── category (string, indexed)
├── difficulty (int 1-5, indexed)
├── question_text (string)
├── ordered_answers (JSON array)
│   ├── rank (int 1-N)
│   ├── answer_text (string)
│   ├── display_value (string)  # "8,849m", "$2.9B", "12 weeks"
│   └── points (int, calculated from rank)
├── tension_cutoff (int, default: 10)
├── accept_variants (JSON)      # {"everest": ["sagarmatha", "chomolungma"]}
├── fuzzy_threshold (float, default: 0.8)
├── submitter (string)          # "ande", "leeroy", "chatgpt", etc.
├── source (string, optional)   # "wikipedia", "manual", etc.
├── tags (JSON array)
├── created_at (timestamp)
└── verified (boolean)          # Flag for user-submitted questions

games
├── id
├── host_id
├── status (setup|active|completed)
├── settings (JSON)
│   ├── rounds (int)
│   ├── time_per_round (int, seconds)
│   ├── doubles_per_player (int, default: 1)
│   └── selected_categories (array)
├── current_round (int)
├── created_at
└── completed_at

players
├── id
├── game_id
├── name
├── device_id (fingerprint)
├── score
├── doubles_remaining
└── joined_at

submissions
├── id
├── game_id
├── player_id
├── question_id
├── submitted_answer (raw)
├── normalized_answer (processed)
├── locked_at (timestamp)
├── used_double (boolean)
├── matched_rank (int or null)
├── points_awarded
└── created_at
```

---

## Answer Matching Strategy

1. **Preprocessing pipeline:**
   - Lowercase
   - Strip punctuation/articles ("the", "a", "an")
   - Normalize whitespace
   - Expand abbreviations ("mt" → "mount", "st" → "saint")
   - Number words → digits

2. **Matching order:**
   - Exact match vs aliases
   - Fuzzy match (Levenshtein ≤ threshold)
   - Phonetic match (Metaphone fallback)

3. **No match found:**
   - Mark as not-on-list (-3)

---

## Bulk Import Format

### JSON (structured)
```json
[
  {
    "category": "Geography",
    "difficulty": 2,
    "question": "Top 10 highest mountains in the world",
    "ordered_answers": [
      {"rank": 1, "answer": "Mount Everest", "value": "8,849m"},
      {"rank": 2, "answer": "K2", "value": "8,611m"}
    ],
    "aliases": {
      "Mount Everest": ["everest", "sagarmatha"],
      "K2": ["godwin-austen"]
    },
    "submitter": "leeroy"
  }
]
```

### CSV (spreadsheet-friendly)
```csv
category,difficulty,question,rank_1_answer,rank_1_value,rank_2_answer,rank_2_value,...,submitter
Geography,2,Top 10 highest mountains,Mount Everest,8.85km,K2,8.61km,...,ande
```

### CSV with full answers (if variable count)
```csv
category,difficulty,question,answers_json,submitter
Geography,2,Top 10 highest mountains,"[{rank:1,answer:'Everest',value:'8.85km'},...]",ande
```

---

## Technical Stack (TBD)

- **Backend:** Node.js/Express or similar
- **Real-time:** Socket.io or WebSocket
- **Database:** SQLite (single file) or PostgreSQL
- **Frontend:** React/Vue/Svelte + Tailwind
- **Phone UI:** Mobile-first responsive
- **TV UI:** Fullscreen, minimal, high contrast

---

## MVP Checklist

- [ ] Database schema setup
- [ ] Bulk import script (JSON)
- [ ] Basic question CRUD
- [ ] Host setup screen
- [ ] Phone join screen
- [ ] Real-time game loop
- [ ] Answer matching (exact + fuzzy)
- [ ] Scoring with tension/penalty
- [ ] Basic reveal UI
- [ ] Double mechanic

---

## Future Work / Spicy Variants

### Turn-based Mode
- Head-to-head duels
- Block opponent categories
- Steal points with correct answer

### Team Mode
- Two teams on couch
- Everyone else buzzes to help
- Combined team score

### Sabotage Rounds
- Freeze opponents (5 second lockout)
- Category swap (force different category)
- Point steal on correct answer

### Custom Packs
- User-created categories
- Import from spreadsheet
- Community verified submissions

### Advanced Config Options
- Multiple doubles per player
- Custom point values
- Adjustable tension cutoff (top 5, top 20)
- Penalty values config
- Click-to-advance reveal (vs auto)

### Social Features
- Session history
- Player profiles
- Leaderboards per category
- Export game replay

---

## Open Questions

1. What happens if multiple players guess the same answer?
   - Option A: Both get points (duplicate allowed)
   - Option B: First to lock gets it, others get nothing

2. ✅ Reveal animation timing?
   - **Auto-advance** (default) — flips every 2-3 seconds
   - Click-to-reveal (future: advanced setting)

3. ✅ Rejoin mid-game?
   - **Host decides:** Wait for reconnect before next question OR continue without them
   - Reconnected players keep their score, join for next round

4. Spectator mode?
   - People on couch without phones can watch

---

*Created: 2026-02-19*
*Last updated: 2026-02-19*
