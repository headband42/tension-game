// ---------------------------------------------------------------------------
// Question manager (/admin). Every /api/admin request needs the server's
// ADMIN_PASSWORD as a bearer token, because these endpoints expose answers.
// ---------------------------------------------------------------------------

/** An answer as written in a question pack (docs/QUESTIONS.md). */
export interface AnswerInput {
  answer: string;
  display?: string;
  aliases: string[];
}

/** A question in question pack format: what the editor sends and the importer accepts. */
export interface QuestionInput {
  category: string;
  question: string;
  cutoff: number;
  difficulty: number;
  submitter?: string;
  source?: string;
  tags: string[];
  /** Ranked best first: the top `cutoff` score, the 3–5 after them are tension answers. */
  answers: AnswerInput[];
}

export interface AdminQuestion extends QuestionInput {
  id: string;
  /** Inactive questions are never drawn for a game. */
  active: boolean;
  /** How many games have drawn it; the least-played questions are picked first. */
  usageCount: number;
  /** Past games that used it. Such a question can be deactivated but not deleted. */
  games: number;
}

export interface AdminCategory {
  id: string;
  name: string;
  /** Questions in an inactive category, or under one, are never drawn. */
  active: boolean;
  /** Questions in this category and its descendants, active or not. */
  questions: number;
  children: AdminCategory[];
}

export const QUESTION_STATUSES = ['all', 'active', 'inactive'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_SORTS = ['category', 'newest', 'most-played', 'least-played'] as const;
export type QuestionSort = (typeof QUESTION_SORTS)[number];

export const QUESTIONS_PER_PAGE = 20;

/** Query parameters of GET /api/admin/questions and GET /api/admin/export. */
export interface QuestionFilters {
  /** Matches the question text, answers and aliases. */
  q?: string;
  /** A category path; includes its sub-categories. */
  category?: string;
  status?: QuestionStatus;
  difficulty?: number;
  tag?: string;
  sort?: QuestionSort;
  /** 1-based. */
  page?: number;
}

export interface QuestionListResponse {
  questions: AdminQuestion[];
  /** Questions matching the filters, across all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/** A problem with a question the editor sent, located like the importer's errors. */
export interface ValidationIssue {
  /** Within the question, e.g. ["answers", 3, "aliases", 0]. */
  path: (string | number)[];
  message: string;
}

export interface SaveQuestionResponse {
  question: AdminQuestion;
  /** Look-alike answers worth a second look; the question was saved anyway. */
  warnings: string[];
}

export interface AdminErrorResponse {
  error: string;
  issues?: ValidationIssue[];
}
