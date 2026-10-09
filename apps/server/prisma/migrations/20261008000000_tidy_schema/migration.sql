-- Drops columns that were never read or kept in sync (answers.points, categories.question_count,
-- games.settings, games.wait_for_reconnects, players.connected, players.last_seen) and renames
-- games.host_id to games.host_token, carrying existing values across.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "answer_text" TEXT NOT NULL,
    "display_value" TEXT,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_answers" ("aliases", "answer_text", "display_value", "id", "question_id", "rank") SELECT "aliases", "answer_text", "display_value", "id", "question_id", "rank" FROM "answers";
DROP TABLE "answers";
ALTER TABLE "new_answers" RENAME TO "answers";
CREATE INDEX "answers_question_id_idx" ON "answers"("question_id");
CREATE INDEX "answers_question_id_rank_idx" ON "answers"("question_id", "rank");
CREATE TABLE "new_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_categories" ("active", "created_at", "depth", "id", "name", "parent_id", "path") SELECT "active", "created_at", "depth", "id", "name", "parent_id", "path" FROM "categories";
DROP TABLE "categories";
ALTER TABLE "new_categories" RENAME TO "categories";
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");
CREATE INDEX "categories_path_idx" ON "categories"("path");
CREATE TABLE "new_games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "host_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "current_round" INTEGER NOT NULL DEFAULT 0,
    "total_rounds" INTEGER NOT NULL DEFAULT 5,
    "time_per_round" INTEGER NOT NULL DEFAULT 45,
    "doubles_per_player" INTEGER NOT NULL DEFAULT 1,
    "selected_categories" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME
);
INSERT INTO "new_games" ("host_token", "code", "completed_at", "created_at", "current_round", "doubles_per_player", "id", "selected_categories", "started_at", "status", "time_per_round", "total_rounds") SELECT "host_id", "code", "completed_at", "created_at", "current_round", "doubles_per_player", "id", "selected_categories", "started_at", "status", "time_per_round", "total_rounds" FROM "games";
DROP TABLE "games";
ALTER TABLE "new_games" RENAME TO "games";
CREATE UNIQUE INDEX "games_code_key" ON "games"("code");
CREATE INDEX "games_status_idx" ON "games"("status");
CREATE TABLE "new_players" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "doubles_remaining" INTEGER NOT NULL DEFAULT 1,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_players" ("device_id", "doubles_remaining", "game_id", "id", "joined_at", "name", "score") SELECT "device_id", "doubles_remaining", "game_id", "id", "joined_at", "name", "score" FROM "players";
DROP TABLE "players";
ALTER TABLE "new_players" RENAME TO "players";
CREATE INDEX "players_game_id_idx" ON "players"("game_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

