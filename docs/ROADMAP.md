# Roadmap

## Known limitations

- **One server process.** Live games are held in memory, so the server can't run as several
  instances behind a load balancer. Multi-instance hosting would need a shared store such as Redis,
  plus the Socket.IO Redis adapter.
- **Trusts the local network.** Anyone who can reach the server can create a game. Only the
  creating browser can host a game, and the answer key isn't exposed over HTTP. There are no
  accounts.
- **No in-app question editor.** Questions are managed through JSON packs, the import CLI and
  Prisma Studio.
- **English-only matching.** Normalization strips accents but drops non-Latin scripts, so answers
  have to be written in Latin letters.
- **Content ages.** Sports and box-office questions are pinned to a date and need refreshing as new
  results come in.
- **No late joining.** New players can't join once the game has started. Existing players can
  always rejoin.

## Ideas

Collected from the original design notes. None of these are built yet.

### Game modes

- **Turn-based duels.** Head-to-head rounds where players can block an opponent's categories.
- **Team mode.** Two teams share phones or a couch, with combined scores.
- **Sabotage rounds.** Freeze an opponent for a few seconds, force a category swap, or steal points
  with a correct answer.
- **Speed rounds.** Shorter timers, rapid fire.

### Rules and settings

- Click-to-advance reveal, so the host reads each answer out with drama, as an alternative to the
  automatic cascade.
- A bonus point for the first player to lock in a given answer.
- Adjustable penalties, double multipliers, and a game-wide cutoff override.
- Let late joiners in mid-game with zero points.
- Filter questions by difficulty.

### Content

- CSV import for questions written in a spreadsheet.
- Community submissions with a verification step. The `submitter` and `source` fields already
  exist for this.
- Category packs that can be shared between installs.

### Presentation

- A QR code on the lobby screen for joining.
- Sound effects: countdown ticks, the tension sting, applause.
- Spectator view for people without a phone.
- Themes.

### History

- Session history and per-category leaderboards. Every submission is already stored.
- Replays and exports of past games.
- Achievements ("Tension Master", "Risk Taker").

## Decisions made so far

| Question                                      | Decision                                                            |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Two players give the same answer?             | Both score it.                                                      |
| Real-time or turn-based?                      | Real-time; turn-based is a possible future mode.                    |
| How is the reveal paced?                      | Automatic cascade from #1 down; the host advances to the next round. |
| What about players who disconnect?            | Their seat is kept. The round waits for them until time runs out, and the host can stop waiting or end the round. |
| What does a blank answer score?               | The same as an answer not on the list (−3), so sitting out isn't free. It never uses up a double. |
| How are subcategories handled?                | A category tree. The host picks any mix of branches.                 |
