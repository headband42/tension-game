<script lang="ts">
  import { goto } from '$app/navigation';
  import { SETTINGS_LIMITS, type CategoryNode, type CreateGameResponse } from '@tension/shared';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CategoryTree from '$lib/components/CategoryTree.svelte';
  import { saveHostToken } from '$lib/storage';

  const limits = SETTINGS_LIMITS;

  let categories = $state<CategoryNode[] | null>(null);
  const selected = new SvelteSet<string>();
  let totalRounds = $state<number>(limits.totalRounds.default);
  let timePerRound = $state<number>(limits.timePerRound.default);
  let doublesPerPlayer = $state<number>(limits.doublesPerPlayer.default);
  let creating = $state(false);
  let error = $state('');

  const flatten = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
  const all = $derived(flatten(categories ?? []).filter((n) => n.ownQuestions > 0));
  const available = $derived(all.reduce((sum, n) => sum + (selected.has(n.id) ? n.ownQuestions : 0), 0));

  onMount(async () => {
    try {
      const response = await fetch('/api/categories');
      if (!response.ok) throw new Error();
      categories = (await response.json()).categories;
      selectAll();
    } catch {
      error = 'Could not load categories. Is the game server running?';
    }
  });

  function selectAll() {
    for (const node of all) selected.add(node.id);
  }

  async function create() {
    creating = true;
    error = '';
    try {
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ totalRounds, timePerRound, doublesPerPlayer, categoryIds: [...selected] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not create the game');
      const { code, hostToken } = body as CreateGameResponse;
      saveHostToken(code, hostToken);
      await goto(`/host/${code}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create the game';
      creating = false;
    }
  }
</script>

<div class="mx-auto max-w-4xl">
  <h1 class="mb-8 text-3xl font-bold">Create game</h1>

  <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
    <section class="card">
      <div class="mb-4 flex items-center justify-between gap-4">
        <h2 class="text-xl font-semibold">Categories</h2>
        {#if categories?.length}
          <div class="flex gap-2 text-sm">
            <button class="text-red-400 hover:underline" onclick={selectAll}>All</button>
            <span class="text-gray-600">/</span>
            <button class="text-red-400 hover:underline" onclick={() => selected.clear()}>None</button>
          </div>
        {/if}
      </div>
      {#if categories === null}
        <p class="text-gray-400">{error ? '' : 'Loading…'}</p>
      {:else if categories.length === 0}
        <p class="text-gray-400">No questions yet. Run <code>bun run setup</code> to import the starter pack.</p>
      {:else}
        <div class="max-h-96 overflow-y-auto pr-2">
          <CategoryTree nodes={categories} {selected} />
        </div>
      {/if}
    </section>

    <section class="card space-y-6">
      <h2 class="text-xl font-semibold">Settings</h2>
      <label class="block">
        <span class="label">Rounds: {totalRounds}</span>
        <input type="range" class="w-full accent-red-500" bind:value={totalRounds} min={limits.totalRounds.min} max={limits.totalRounds.max} />
        {#if categories && totalRounds > available}
          <span class="mt-1 block text-sm text-yellow-400">
            Only {available} question{available === 1 ? '' : 's'} selected — the game will be {available} round{available === 1 ? '' : 's'}.
          </span>
        {/if}
      </label>
      <label class="block">
        <span class="label">Time to answer: {timePerRound}s</span>
        <input
          type="range"
          class="w-full accent-red-500"
          bind:value={timePerRound}
          min={limits.timePerRound.min}
          max={limits.timePerRound.max}
          step={limits.timePerRound.step}
        />
      </label>
      <label class="block">
        <span class="label">Doubles per player: {doublesPerPlayer}</span>
        <input
          type="range"
          class="w-full accent-red-500"
          bind:value={doublesPerPlayer}
          min={limits.doublesPerPlayer.min}
          max={limits.doublesPerPlayer.max}
        />
      </label>
    </section>
  </div>

  {#if error}<p class="mt-6 text-center text-red-400">{error}</p>{/if}

  <div class="mt-8 flex items-center justify-center gap-4">
    <a href="/" class="btn btn-secondary">Back</a>
    <button class="btn btn-primary px-12 py-4 text-lg" onclick={create} disabled={creating || available === 0}>
      {creating ? 'Creating…' : 'Create game'}
    </button>
  </div>
</div>
