<script lang="ts">
  import { MISS_PENALTY, TENSION_PENALTY, type GameView } from '@tension/shared';
  import { game } from '$lib/game.svelte';
  import Countdown from './Countdown.svelte';

  let { view }: { view: GameView } = $props();

  const question = $derived(view.question!);
  const locked = $derived(view.players.filter((p) => p.status === 'locked').length);
  const waitingOffline = $derived(view.players.some((p) => !p.connected && p.status !== 'locked'));
</script>

<div class="mx-auto max-w-5xl space-y-8">
  <div class="flex items-start justify-between gap-6">
    <div>
      <p class="text-lg text-gray-400">Round {view.round} of {view.totalRounds}</p>
      <p class="text-sm tracking-wide text-red-400 uppercase">{question.category}</p>
    </div>
    <div class="w-48"><Countdown deadline={game.deadline} totalSeconds={view.settings.timePerRound} large /></div>
  </div>

  <div class="card py-12 text-center">
    <h1 class="text-4xl font-bold text-balance md:text-5xl">{question.text}</h1>
    <p class="mt-6 text-sm text-gray-400">
      There are <span class="font-semibold text-red-400">{question.tensionCount} tension answers</span> lurking just
      below the top {question.cutoff} ({TENSION_PENALTY}) · any other wrong answer {MISS_PENALTY}
    </p>
  </div>

  <div class="card">
    <h2 class="mb-4 text-xl font-semibold">{locked} of {view.players.length} locked in</h2>
    <ul class="grid grid-cols-2 gap-3 md:grid-cols-4">
      {#each view.players as player (player.id)}
        <li
          class={[
            'rounded-lg p-4',
            player.status === 'locked' ? 'bg-green-900/50' : player.status === 'typing' ? 'bg-yellow-900/40' : 'bg-gray-700',
            !player.connected && player.status !== 'locked' && 'opacity-60',
          ]}
        >
          <div class="truncate font-medium">{player.name}</div>
          <div class="text-sm text-gray-300">
            {#if player.status === 'locked'}
              Locked in {player.doubled ? '🔥' : '🔒'}
            {:else if !player.connected}
              Offline
            {:else if player.status === 'typing'}
              Typing…
            {:else}
              Thinking…
            {/if}
          </div>
        </li>
      {/each}
    </ul>

    <div class="mt-6 flex flex-wrap justify-end gap-3">
      {#if waitingOffline && !view.skipOffline}
        <button class="btn btn-secondary" onclick={game.skipOffline}>Stop waiting for offline players</button>
      {/if}
      <button class="btn btn-primary" onclick={game.endRound}>End round now</button>
    </div>
  </div>
</div>
