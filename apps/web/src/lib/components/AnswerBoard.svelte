<script lang="ts">
  import type { PlayerView, RevealView } from '@tension/shared';
  import { fly } from 'svelte/transition';

  let { reveal, players, cutoff }: { reveal: RevealView; players: PlayerView[]; cutoff: number } = $props();

  const names = $derived(new Map(players.map((p) => [p.id, p.name])));
  const hits = $derived(reveal.answers.filter((a) => a.rank <= cutoff));
  const tension = $derived(reveal.answers.filter((a) => a.rank > cutoff));
  const misses = $derived(reveal.results.filter((r) => r.outcome === 'miss'));
  const doubled = $derived(new Set(reveal.results.filter((r) => r.doubled).map((r) => r.playerId)));

  /** Rows fly in one by one, #1 first, the way the answers get read out on TV. */
  const STEP_MS = 180;

  function who(ids: string[]) {
    return ids.map((id) => `${names.get(id) ?? '?'}${doubled.has(id) ? ' 🔥' : ''}`).join(', ');
  }
</script>

<div class="space-y-6">
  <section class="card">
    <h3 class="mb-4 text-xl font-semibold">The top {cutoff}</h3>
    <ol class="space-y-2">
      {#each hits as answer, i (answer.rank)}
        <li
          in:fly={{ y: 12, delay: i * STEP_MS }}
          class={['flex items-center gap-4 rounded-lg p-3', answer.pickedBy.length ? 'bg-green-900/40' : 'bg-gray-700/40']}
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-700 font-bold">{answer.rank}</span>
          <div class="min-w-0 flex-1">
            <div class="font-medium">{answer.text}</div>
            {#if answer.displayValue}<div class="text-xs text-gray-400">{answer.displayValue}</div>{/if}
            {#if answer.pickedBy.length}<div class="mt-1 text-sm text-green-400">{who(answer.pickedBy)}</div>{/if}
          </div>
          <span class="text-lg font-bold text-green-400">+{answer.points}</span>
        </li>
      {/each}
    </ol>
  </section>

  {#if tension.length > 0}
    <section class="card" in:fly={{ y: 12, delay: hits.length * STEP_MS }}>
      <h3 class="mb-1 text-xl font-semibold text-red-400">Tension zone</h3>
      <p class="mb-4 text-sm text-gray-400">Lurking just below the top {cutoff}: {tension[0].points} points.</p>
      <ul class="grid gap-2 sm:grid-cols-2">
        {#each tension as answer (answer.rank)}
          <li class={['flex items-baseline gap-3 rounded-lg p-2', answer.pickedBy.length ? 'bg-red-900/50' : 'bg-gray-700/30']}>
            <span class="w-8 text-right text-sm text-gray-400">#{answer.rank}</span>
            <span class="flex-1">
              {answer.text}
              {#if answer.pickedBy.length}<span class="block text-sm text-red-300">{who(answer.pickedBy)} 💀</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if misses.length > 0}
    <section class="card" in:fly={{ y: 12, delay: (hits.length + 1) * STEP_MS }}>
      <h3 class="mb-4 text-xl font-semibold">Not on the list</h3>
      <ul class="space-y-2">
        {#each misses as miss (miss.playerId)}
          <li class="flex items-center gap-4 rounded-lg bg-gray-700/40 p-3">
            <span class="flex-1">
              <span class="font-medium">{names.get(miss.playerId)}</span>
              <span class="text-gray-400">— {miss.answer ? `“${miss.answer}”` : 'no answer'}</span>
            </span>
            <span class="font-bold text-red-400">{miss.points}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
