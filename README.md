# Tension Game

A real-time multiplayer party game inspired by "Tension" (Tenable). Players join from phones, host controls main screen.

## Quick Start

```bash
# Install dependencies
bun install

# Setup database (already done)
cd apps/server
bunx prisma migrate dev
bun run seed

# Start both servers
cd ../..
bun run dev
```

Then open:
- Frontend: http://localhost:5173
- API: http://localhost:3001

## How to Play

1. **Host**: Click "Create Game", select categories, configure settings
2. **Players**: Click "Join Game", enter the game code
3. **Host**: Start the game when everyone's joined
4. **Everyone**: Answer the questions - top 10 answers get points, #11+ loses points (TENSION!)
5. Use your DOUBLE wisely to double your points (or losses!)

## Project Structure

```
tension-game/
├── apps/
│   ├── server/          # Bun + Hono + Socket.io backend
│   │   ├── src/routes/  # REST API routes
│   │   ├── src/socket/  # Socket.io game handler
│   │   └── prisma/      # Database schema
│   └── web/             # SvelteKit frontend
│       └── src/routes/  # UI pages
├── PLAN.md              # Full design document
├── PLAN_APPEND.md       # Implementation tasks
└── SPEC.md              # Core spec
```

## Tech Stack

- **Backend**: Bun, Hono, Socket.io, Prisma, SQLite
- **Frontend**: SvelteKit, TailwindCSS, Socket.io-client
- **Real-time**: WebSockets via Socket.io

## Features Implemented

- [x] Create/join games with unique codes
- [x] Category selection with tree structure
- [x] Real-time gameplay with WebSockets
- [x] Answer submission and locking
- [x] Scoring system (#1-#10 points, TENSION penalty)
- [x] Double mechanic
- [x] Leaderboard and results
- [x] Mobile-responsive player UI
- [x] Host control screen

## Database

SQLite database with tables for:
- Categories (hierarchical)
- Questions with answers
- Games, players, submissions

Sample data included: Geography (mountains, cities), Sports (baseball championships)
