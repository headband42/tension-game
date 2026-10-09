<script lang="ts">
  import type { PlayerView, RoundResult } from '@tension/shared';

  let {
    players,
    results = [],
    highlight = null,
  }: { players: PlayerView[]; results?: RoundResult[]; highlight?: string | null } = $props();

  const delta = $derived(new Map(results.map((r) => [r.playerId, r.points])));
  // Players on the same score share a place.
  const rows = $derived(
    [...players]
      .sort((a, b) => b.score - a.score)
      .map((player, i, sorted) => ({ player, place: sorted.findIndex((p) => p.score === player.score) + 1 })),
  );

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
</script>

<ol class="space-y-2">
  {#each rows as { player, place } (player.id)}
    {@const change = delta.get(player.id)}
    <li
      class={[
        'flex items-center gap-4 rounded-lg p-3',
        player.id === highlight ? 'bg-red-500/20 ring-2 ring-red-500' : place === 1 ? 'bg-yellow-900/30' : 'bg-gray-700/50',
      ]}
    >
      <span class="w-8 text-center text-xl font-bold text-gray-300">{place}</span>
      <span class="flex-1 truncate font-medium">
        {player.name}
        {#if !player.connected}<span class="ml-1 text-xs text-gray-500">offline</span>{/if}
      </span>
      {#if change !== undefined}
        <span class={['text-sm font-semibold', change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-400']}>
          {signed(change)}
        </span>
      {/if}
      <span class="w-12 text-right text-xl font-bold tabular-nums">{player.score}</span>
    </li>
  {/each}
</ol>
