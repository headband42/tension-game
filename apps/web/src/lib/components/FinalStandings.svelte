<script lang="ts">
  import type { PlayerView } from '@tension/shared';

  let { players, highlight = null }: { players: PlayerView[]; highlight?: string | null } = $props();

  const MEDALS = ['🥇', '🥈', '🥉'];
  const rows = $derived(
    [...players]
      .sort((a, b) => b.score - a.score)
      .map((player, _, sorted) => ({ player, place: sorted.findIndex((p) => p.score === player.score) + 1 })),
  );
</script>

<div class="card">
  <h2 class="mb-6 text-center text-3xl font-bold">Final standings</h2>
  <ol class="space-y-3">
    {#each rows as { player, place } (player.id)}
      <li
        class={[
          'flex items-center gap-4 rounded-lg border-2 p-4',
          place === 1 && 'border-yellow-500 bg-yellow-500/20',
          place === 2 && 'border-gray-400 bg-gray-400/20',
          place === 3 && 'border-orange-600 bg-orange-600/20',
          place > 3 && 'border-transparent bg-gray-700',
          player.id === highlight && 'ring-2 ring-red-500',
        ]}
      >
        <span class="w-12 text-center text-3xl font-bold">{MEDALS[place - 1] ?? place}</span>
        <span class="flex-1 truncate text-xl font-bold">{player.name}</span>
        <span class="text-3xl font-bold tabular-nums">{player.score}</span>
      </li>
    {/each}
  </ol>
</div>
