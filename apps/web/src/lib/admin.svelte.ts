import {
  QUESTION_SORTS,
  QUESTION_STATUSES,
  type AdminErrorResponse,
  type QuestionFilters,
  type ValidationIssue,
} from '@tension/shared';
import { adminPassword, forgetAdminPassword, saveAdminPassword } from './storage';

export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

/**
 * - `checking`: nothing asked yet
 * - `signed-out`: the server wants a (different) password
 * - `off`: the server has no ADMIN_PASSWORD, so the manager is unavailable
 * - `ready`: the password works
 */
export type AdminStatus = 'checking' | 'signed-out' | 'off' | 'ready';

/**
 * The question manager's connection to /api/admin. Every request carries the
 * password; the server's answer keeps `status` current, so a 401 anywhere
 * sends the page back to the sign-in form.
 */
class AdminClient {
  status = $state<AdminStatus>('checking');

  #password = adminPassword() ?? '';

  /** Sends this password from now on. It's remembered once the server accepts it. */
  usePassword(password: string) {
    this.#password = password;
  }

  signOut() {
    this.#password = '';
    forgetAdminPassword();
    this.status = 'signed-out';
  }

  async request<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/admin${path}`, {
        method,
        headers: {
          // URI-encoded so a password with any characters fits in a header.
          authorization: `Bearer ${encodeURIComponent(this.#password)}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AdminRequestError('Could not reach the game server', 0);
    }

    if (response.status === 401) {
      forgetAdminPassword();
      this.status = 'signed-out';
    } else if (response.status === 403) {
      this.status = 'off';
    } else if (response.ok && this.status !== 'ready') {
      saveAdminPassword(this.#password);
      this.status = 'ready';
    }

    const result: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = result as Partial<AdminErrorResponse> | null;
      throw new AdminRequestError(error?.error ?? `The server answered ${response.status}`, response.status, error?.issues);
    }
    return result as T;
  }
}

export const admin = new AdminClient();

const DEFAULTS: QuestionFilters = { status: 'all', sort: 'category', page: 1 };

/** Filters from the page's query string; anything unrecognised is ignored. */
export function readFilters(params: URLSearchParams): QuestionFilters {
  const number = (key: string) => (/^\d+$/.test(params.get(key) ?? '') ? Number(params.get(key)) : undefined);
  const difficulty = number('difficulty');
  return {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    status: QUESTION_STATUSES.find((status) => status === params.get('status')),
    difficulty: difficulty && difficulty <= 5 ? difficulty : undefined,
    tag: params.get('tag') || undefined,
    sort: QUESTION_SORTS.find((sort) => sort === params.get('sort')),
    page: number('page') || undefined,
  };
}

/** The filters as a query string ("" or "?…"), leaving out defaults so URLs stay short. */
export function filterQuery(filters: QuestionFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== DEFAULTS[key as keyof QuestionFilters]) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
