<script lang="ts">
  import type { GameView } from '@tension/shared';
  import { game } from '$lib/game.svelte';
  import AnswerBoard from './AnswerBoard.svelte';
  import Standings from './Standings.svelte';

  let { view }: { view: GameView } = $props();

  const lastRound = $derived(view.round >= view.totalRounds);
</script>

<div class="mx-auto max-w-6xl space-y-6">
  {#if view.reveal && view.question}
    <div class="text-center">
      <p class="text-gray-400">Round {view.round} of {view.totalRounds} · {view.question.category}</p>
      <h1 class="mt-1 text-3xl font-bold text-balance">{view.question.text}</h1>
    </div>

    <div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <AnswerBoard reveal={view.reveal} players={view.players} cutoff={view.question.cutoff} />
      <div class="card h-fit">
        <h2 class="mb-4 text-xl font-semibold">Standings</h2>
        <Standings players={view.players} results={view.reveal.results} />
      </div>
    </div>
  {:else}
    <div class="card mx-auto max-w-xl text-center">
      <h1 class="mb-2 text-2xl font-bold">Game resumed</h1>
      <p class="text-gray-400">
        The server restarted. Scores are saved{view.round > 0 ? ` through round ${view.round}` : ''} — carry on when
        everyone is back.
      </p>
      <div class="mt-6 text-left"><Standings players={view.players} /></div>
    </div>
  {/if}

  <div class="text-center">
    <button class="btn btn-success px-12 py-4 text-lg" onclick={game.next}>
      {lastRound ? 'Final standings' : 'Next round'}
    </button>
  </div>
</div>
