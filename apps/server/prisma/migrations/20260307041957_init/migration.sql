-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "question_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category_id" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "question_text" TEXT NOT NULL,
    "tension_cutoff" INTEGER NOT NULL DEFAULT 10,
    "submitter" TEXT,
    "source" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "answer_text" TEXT NOT NULL,
    "display_value" TEXT,
    "points" INTEGER NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'setup',
    "current_round" INTEGER NOT NULL DEFAULT 0,
    "total_rounds" INTEGER NOT NULL DEFAULT 5,
    "time_per_round" INTEGER NOT NULL DEFAULT 45,
    "doubles_per_player" INTEGER NOT NULL DEFAULT 1,
    "wait_for_reconnects" BOOLEAN NOT NULL DEFAULT true,
    "selected_categories" TEXT NOT NULL DEFAULT '[]',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME
);

-- CreateTable
CREATE TABLE "game_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "asked_at" DATETIME,
    CONSTRAINT "game_questions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "game_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "doubles_remaining" INTEGER NOT NULL DEFAULT 1,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "submitted_answer" TEXT NOT NULL,
    "normalized_answer" TEXT,
    "answer_match_id" TEXT,
    "matched_rank" INTEGER,
    "points_awarded" INTEGER,
    "used_double" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submissions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submissions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE INDEX "questions_category_id_idx" ON "questions"("category_id");

-- CreateIndex
CREATE INDEX "questions_difficulty_idx" ON "questions"("difficulty");

-- CreateIndex
CREATE INDEX "questions_active_idx" ON "questions"("active");

-- CreateIndex
CREATE INDEX "answers_question_id_idx" ON "answers"("question_id");

-- CreateIndex
CREATE INDEX "answers_question_id_rank_idx" ON "answers"("question_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "games_code_key" ON "games"("code");

-- CreateIndex
CREATE INDEX "games_code_idx" ON "games"("code");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "games"("status");

-- CreateIndex
CREATE INDEX "game_questions_game_id_idx" ON "game_questions"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_questions_game_id_round_number_key" ON "game_questions"("game_id", "round_number");

-- CreateIndex
CREATE INDEX "players_game_id_idx" ON "players"("game_id");

-- CreateIndex
CREATE INDEX "submissions_game_id_idx" ON "submissions"("game_id");

-- CreateIndex
CREATE INDEX "submissions_game_id_round_idx" ON "submissions"("game_id", "round");
