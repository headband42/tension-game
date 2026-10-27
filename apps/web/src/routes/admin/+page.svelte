<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    DEFAULT_CUTOFF,
    MIN_TENSION_ANSWERS,
    QUESTION_SORTS,
    type AdminCategory,
    type AdminQuestion,
    type QuestionFilters,
    type QuestionInput,
    type QuestionListResponse,
    type QuestionSort,
    type SaveQuestionResponse,
  } from '@tension/shared';
  import { onMount, untrack } from 'svelte';
  import { admin, filterQuery, readFilters } from '$lib/admin.svelte';
  import FilterSidebar from '$lib/components/admin/FilterSidebar.svelte';
  import QuestionCard from '$lib/components/admin/QuestionCard.svelte';
  import QuestionEditor from '$lib/components/admin/QuestionEditor.svelte';

  type Notice = { tone: 'success' | 'error'; text: string; warnings?: string[]; show?: QuestionFilters };

  const SORT_NAMES: Record<QuestionSort, string> = {
    category: 'By category',
    newest: 'Newest first',
    'most-played': 'Most played',
    'least-played': 'Least played',
  };

  // The filters live in the URL, so reloading, the back button and links all keep them.
  const filters = $derived(readFilters(page.url.searchParams));
  const query = $derived(filterQuery(filters));

  let categories = $state<AdminCategory[]>([]);
  let list = $state<QuestionListResponse | null>(null);
  let loading = $state(false);
  let loadError = $state('');
  let notice = $state<Notice | null>(null);
  /** The question in the editor. Without an id it's a new question, possibly copied from another. */
  let editing = $state<{ id?: string; question: QuestionInput } | null>(null);
  /** The question waiting on a server request. */
  let busy = $state<string | null>(null);
  let showAnswers = $state(true);
  let sidebarOpen = $state(false);
  let results = $state<HTMLElement>();

  let password = $state('');
  let signingIn = $state(false);
  let signInError = $state('');

  const flatten = (nodes: AdminCategory[]): AdminCategory[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
  const allCategories = $derived(flatten(categories));
  const categoryNames = $derived(new Map(allCategories.map((c) => [c.id, c.name])));
  const pages = $derived(list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1);

  const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

  function categoryLabel(path: string) {
    return path
      .split('/')
      .map((slug, depth, slugs) => categoryNames.get(slugs.slice(0, depth + 1).join('/')) ?? slug)
      .join(' › ');
  }

  /** Changes some filters; any change goes back to the first page unless it sets one. */
  function setFilters(patch: QuestionFilters, replace = false) {
    if (!replace) sidebarOpen = false;
    const url = `${page.url.pathname}${filterQuery({ ...filters, page: undefined, ...patch })}`;
    void goto(url, { replaceState: replace, keepFocus: true, noScroll: true });
  }

  async function loadCategories() {
    try {
      categories = (await admin.request<{ categories: AdminCategory[] }>('/categories')).categories;
      loadError = '';
    } catch (e) {
      loadError = message(e);
    }
  }

  let latestRequest = 0;
  /** The query whose questions are on screen; a different one scrolls back to the top. */
  let shownQuery: string | null = null;

  async function loadQuestions(forQuery: string) {
    const request = ++latestRequest;
    loading = true;
    try {
      const response = await admin.request<QuestionListResponse>(`/questions${forQuery}`);
      if (request !== latestRequest) return;
      list = response;
      loadError = '';
      if (forQuery !== shownQuery) results?.scrollTo({ top: 0 });
      shownQuery = forQuery;
    } catch (e) {
      if (request === latestRequest) loadError = message(e);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  const reload = () => Promise.all([loadQuestions(query), loadCategories()]);

  // Also tells whether the server wants a password.
  onMount(loadCategories);

  $effect(() => {
    const forQuery = query;
    if (admin.status === 'ready') untrack(() => loadQuestions(forQuery));
  });

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    signingIn = true;
    admin.usePassword(password);
    await loadCategories();
    signInError = admin.status === 'ready' ? '' : loadError;
    signingIn = false;
  }

  function signOut() {
    admin.signOut();
    password = '';
    void loadCategories();
  }

  function newQuestion() {
    const answers = Array.from({ length: DEFAULT_CUTOFF + MIN_TENSION_ANSWERS }, () => ({ answer: '', aliases: [] }));
    editing = { question: { category: filters.category ?? '', question: '', cutoff: DEFAULT_CUTOFF, difficulty: 1, tags: [], answers } };
  }

  function saved({ question, warnings }: SaveQuestionResponse, created: boolean) {
    editing = null;
    notice = created
      ? { tone: 'success', text: `Added “${question.question}”.`, warnings, show: { category: question.category, sort: 'newest' } }
      : { tone: 'success', text: 'Changes saved.', warnings };
    void reload();
  }

  async function toggle(question: AdminQuestion) {
    busy = question.id;
    try {
      const { question: updated } = await admin.request<{ question: AdminQuestion }>(`/questions/${question.id}`, {
        method: 'PATCH',
        body: { active: !question.active },
      });
      // Stays in place even if it no longer matches the status filter, so the list doesn't jump.
      if (list) list.questions = list.questions.map((q) => (q.id === updated.id ? updated : q));
      notice = null;
    } catch (e) {
      notice = { tone: 'error', text: message(e) };
    }
    busy = null;
  }

  async function remove(question: AdminQuestion) {
    if (!confirm(`Delete “${question.question}”? This can't be undone.`)) return;
    busy = question.id;
    try {
      await admin.request(`/questions/${question.id}`, { method: 'DELETE' });
      await reload();
      notice = { tone: 'success', text: 'Question deleted.' };
    } catch (e) {
      notice = { tone: 'error', text: message(e) };
    }
    busy = null;
  }

  /** Downloads the questions matching the filters as a question pack, ready for `bun run import`. */
  async function exportPack() {
    try {
      const pack = await admin.request<unknown>(`/export${filterQuery({ ...filters, page: undefined })}`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: 'application/json' }));
      link.download = `${filters.category?.replaceAll('/', '-') ?? 'questions'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href));
    } catch (e) {
      notice = { tone: 'error', text: message(e) };
    }
  }
</script>

<svelte:head><title>Question manager · Tension</title></svelte:head>

{#if admin.status === 'ready'}
  <div class="fixed inset-0 flex flex-col bg-gray-900">
    <header class="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
      <button
        type="button"
        class="btn btn-secondary btn-sm lg:hidden"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        Filters
      </button>
      <a href="/" class="text-xl font-black tracking-tight text-red-500">TENSION</a>
      <span class="hidden text-gray-400 sm:inline">Question manager</span>
      {#if admin.signedIn}
        <button type="button" class="ml-auto text-sm text-gray-400 hover:text-white" onclick={signOut}>Sign out</button>
      {:else}
        <span
          class="ml-auto text-sm text-gray-500"
          title="Anyone who can reach this server can open this page. To require a password, set ADMIN_PASSWORD in apps/server/.env."
        >
          No password
        </span>
      {/if}
    </header>

    <div class="relative flex min-h-0 flex-1">
      {#if sidebarOpen}
        <button type="button" class="absolute inset-0 z-10 bg-black/60 lg:hidden" aria-label="Close filters" onclick={() => (sidebarOpen = false)}
        ></button>
      {/if}
      <aside
        class={[
          'w-80 shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-900 p-4',
          sidebarOpen ? 'absolute inset-y-0 left-0 z-20 shadow-2xl lg:static' : 'hidden lg:block',
        ]}
        aria-label="Filters"
      >
        <FilterSidebar {categories} {filters} onchange={setFilters} />
      </aside>

      <section bind:this={results} class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={loading}>
        <div class="mx-auto max-w-5xl">
          <div class="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div class="min-w-0 flex-1 basis-64">
              <h1 class="truncate text-2xl font-bold">{filters.category ? categoryLabel(filters.category) : 'All questions'}</h1>
              <p class="text-sm text-gray-400">
                {#if list && list.total > 0}
                  {(list.page - 1) * list.pageSize + 1}–{Math.min(list.page * list.pageSize, list.total)} of {list.total}
                  question{list.total === 1 ? '' : 's'}
                {:else if list}
                  No questions
                {:else}
                  Loading…
                {/if}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="flex items-center gap-2 pr-2 text-sm text-gray-300">
                <input type="checkbox" class="size-4 accent-red-500" bind:checked={showAnswers} />
                Answers
              </label>
              <select
                class="input input-sm w-auto"
                aria-label="Sort"
                value={filters.sort ?? 'category'}
                onchange={(event) => setFilters({ sort: QUESTION_SORTS.find((sort) => sort === event.currentTarget.value) })}
              >
                {#each QUESTION_SORTS as sort (sort)}<option value={sort}>{SORT_NAMES[sort]}</option>{/each}
              </select>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onclick={exportPack}
                disabled={!list?.total}
                title="Download the questions matching these filters as a question pack for `bun run import`"
              >
                Export
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick={newQuestion}>New question</button>
            </div>
          </div>

          {#if notice}
            <div
              class={[
                'mb-6 rounded-lg border px-4 py-3 text-sm',
                notice.tone === 'success' ? 'border-green-700 bg-green-950/60 text-green-100' : 'border-red-700 bg-red-950/60 text-red-100',
              ]}
              role="status"
            >
              <div class="flex items-start gap-3">
                <p class="flex-1">{notice.text}</p>
                {#if notice.show}
                  {@const show = notice.show}
                  <button type="button" class="font-semibold underline" onclick={() => void goto(`${page.url.pathname}${filterQuery(show)}`)}>
                    Show it
                  </button>
                {/if}
                <button type="button" class="text-lg leading-none opacity-70 hover:opacity-100" aria-label="Dismiss" onclick={() => (notice = null)}
                  >×</button
                >
              </div>
              {#if notice.warnings?.length}
                <p class="mt-2 text-yellow-200">Worth a second look:</p>
                <ul class="list-disc pl-5 text-yellow-200">
                  {#each notice.warnings as warning, i (i)}<li>{warning}</li>{/each}
                </ul>
              {/if}
            </div>
          {/if}

          {#if loadError}
            <p class="mb-6 rounded-lg border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-100">{loadError}</p>
          {/if}

          {#if list && list.questions.length > 0}
            <div class={['space-y-4 transition-opacity', loading && 'opacity-60']}>
              {#each list.questions as question (question.id)}
                <QuestionCard
                  {question}
                  {categoryNames}
                  {showAnswers}
                  busy={busy === question.id}
                  onedit={() => (editing = { id: question.id, question })}
                  oncopy={() => (editing = { question })}
                  ontoggle={() => toggle(question)}
                  ondelete={() => remove(question)}
                  oncategory={(category) => setFilters({ category })}
                  ontag={(tag) => setFilters({ tag })}
                />
              {/each}
            </div>

            {#if pages > 1}
              <nav class="mt-8 flex items-center justify-center gap-4" aria-label="Pages">
                <button type="button" class="btn btn-secondary btn-sm" disabled={list.page <= 1} onclick={() => setFilters({ page: list!.page - 1 })}>
                  ← Previous
                </button>
                <span class="text-sm text-gray-400">Page {list.page} of {pages}</span>
                <button type="button" class="btn btn-secondary btn-sm" disabled={list.page >= pages} onclick={() => setFilters({ page: list!.page + 1 })}>
                  Next →
                </button>
              </nav>
            {/if}
          {:else if list && list.total > 0}
            <p class="py-16 text-center text-gray-400">
              Nothing on this page. <button type="button" class="text-red-400 hover:underline" onclick={() => setFilters({})}>Go to the first page</button>
            </p>
          {:else if list}
            <p class="py-16 text-center text-gray-400">No questions match these filters.</p>
          {/if}
        </div>
      </section>
    </div>
  </div>

  {#if editing}
    <QuestionEditor
      id={editing.id}
      question={editing.question}
      categoryPaths={allCategories.map((c) => c.id)}
      onclose={() => (editing = null)}
      onsaved={saved}
    />
  {/if}
{:else}
  <div class="mx-auto mt-[12dvh] w-full max-w-sm">
    <h1 class="mb-8 text-center text-3xl font-bold">Question manager</h1>
    {#if admin.status === 'checking'}
      <p class="text-center text-gray-400">{loadError || 'Loading…'}</p>
    {:else}
      <form class="card space-y-4" onsubmit={signIn}>
        <p class="text-sm text-gray-400">
          This server keeps its answers behind a password. It's <code class="text-white">ADMIN_PASSWORD</code> in
          <code class="text-white">apps/server/.env</code> on the computer running the game.
        </p>
        <label class="block">
          <span class="label">Password</span>
          <input class="input" type="password" autocomplete="current-password" bind:value={password} />
        </label>
        {#if signInError}<p class="text-center text-sm text-red-400">{signInError}</p>{/if}
        <button class="btn btn-primary w-full" disabled={signingIn || !password}>{signingIn ? 'Checking…' : 'Sign in'}</button>
      </form>
    {/if}
    <p class="mt-6 text-center"><a href="/" class="text-gray-400 transition-colors hover:text-white">← Back</a></p>
  </div>
{/if}
