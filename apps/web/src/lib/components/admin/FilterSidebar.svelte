<script lang="ts">
  import { QUESTION_STATUSES, type AdminCategory, type QuestionFilters } from '@tension/shared';
  import CategoryFilter from './CategoryFilter.svelte';

  let {
    categories,
    filters,
    onchange,
  }: {
    categories: AdminCategory[];
    filters: QuestionFilters;
    /** `replace` swaps the history entry rather than adding one, for changes made while typing. */
    onchange: (patch: QuestionFilters, replace?: boolean) => void;
  } = $props();

  const DIFFICULTIES = [1, 2, 3, 4, 5];
  const total = $derived(categories.reduce((sum, c) => sum + c.questions, 0));
  const filtered = $derived(Boolean(filters.q || filters.category || filters.status || filters.difficulty || filters.tag));

  // The search box applies what's typed after a pause. `sent` is the last value
  // it applied, so only a change from elsewhere (like "Clear filters") resets it.
  let search = $state('');
  let sent: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const q = filters.q ?? '';
    if (q !== sent) search = sent = q;
  });

  function typed() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      sent = search;
      onchange({ q: search || undefined }, true);
    }, 250);
  }
</script>

<div class="space-y-6">
  <!-- Pinned to the top of the scrolling sidebar (offset by its padding), so search stays at hand. -->
  <div class="sticky -top-4 z-10 -mx-4 -mt-4 bg-gray-900 px-4 pt-4 pb-1">
    <input
      type="search"
      class="input input-sm"
      placeholder="Search questions and answers"
      aria-label="Search questions and answers"
      bind:value={search}
      oninput={typed}
    />
  </div>

  <section>
    <h2 class="label">Status</h2>
    <div class="grid grid-cols-3 gap-1 rounded-lg bg-gray-800 p-1 text-sm">
      {#each QUESTION_STATUSES as status (status)}
        {@const current = (filters.status ?? 'all') === status}
        <button
          type="button"
          class={['rounded-md py-1 capitalize', current ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white']}
          aria-pressed={current}
          onclick={() => onchange({ status: status === 'all' ? undefined : status })}
        >
          {status}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="label">Difficulty</h2>
    <div class="grid grid-cols-6 gap-1 rounded-lg bg-gray-800 p-1 text-sm">
      {#each [undefined, ...DIFFICULTIES] as difficulty (difficulty ?? 0)}
        {@const current = filters.difficulty === difficulty}
        <button
          type="button"
          class={['rounded-md py-1', current ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white']}
          aria-pressed={current}
          aria-label={difficulty ? `Difficulty ${difficulty}` : 'Any difficulty'}
          onclick={() => onchange({ difficulty })}
        >
          {difficulty ?? 'Any'}
        </button>
      {/each}
    </div>
  </section>

  {#if filters.tag}
    <section>
      <h2 class="label">Tag</h2>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-sm text-red-200 hover:bg-red-500/30"
        aria-label={`Stop filtering by the tag ${filters.tag}`}
        onclick={() => onchange({ tag: undefined })}
      >
        #{filters.tag} <span aria-hidden="true">×</span>
      </button>
    </section>
  {/if}

  <section>
    <h2 class="label">Categories</h2>
    <button
      type="button"
      class={[
        'mb-1 flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-9 text-left text-sm',
        filters.category ? 'text-gray-300 hover:bg-gray-800' : 'bg-red-500/20 text-white',
      ]}
      aria-pressed={!filters.category}
      onclick={() => onchange({ category: undefined })}
    >
      <span class="flex-1">All categories</span>
      <span class="text-xs text-gray-500 tabular-nums">{total}</span>
    </button>
    <CategoryFilter nodes={categories} selected={filters.category} onselect={(category) => onchange({ category })} />
  </section>

  {#if filtered}
    <button
      type="button"
      class="text-sm text-red-400 hover:underline"
      onclick={() => onchange({ q: undefined, category: undefined, status: undefined, difficulty: undefined, tag: undefined })}
    >
      Clear filters
    </button>
  {/if}
</div>
