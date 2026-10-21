<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { DOUBLE_MULTIPLIER, MAX_ANSWER_LENGTH, normalizeCode } from '@tension/shared';
  import { untrack } from 'svelte';
  import Countdown from '$lib/components/Countdown.svelte';
  import FinalStandings from '$lib/components/FinalStandings.svelte';
  import Standings from '$lib/components/Standings.svelte';
  import { game } from '$lib/game.svelte';
  import { savedName } from '$lib/storage';
  import { Ticker } from '$lib/ticker.svelte';

  const code = $derived(normalizeCode(page.params.code ?? ''));
  let problem = $state<string | null>(null);

  async function connect(target: string) {
    if (game.isSeated('player', target)) return;
    const name = savedName();
    if (!name) return void goto(`/join?code=${target}`, { replaceState: true });
    problem = null;
    const result = await game.joinGame(target, name);
    if (!result.ok && target === code) problem = result.error;
  }

  $effect(() => {
    const target = code;
    untrack(() => void connect(target));
  });

  const view = $derived(game.isSeated('player', code) ? game.game : null);
  const me = $derived(view?.players.find((p) => p.id === game.you?.playerId));
  const myResult = $derived(view?.reveal?.results.find((r) => r.playerId === game.you?.playerId));

  // ---- Answering ----------------------------------------------------------

  let answer = $state('');
  let useDouble = $state(false);
  let lockedLocally = $state(false);
  let roundShown = 0;
  let autoLocked = false;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  const locked = $derived(lockedLocally || Boolean(game.you?.locked));
  const ticker = new Ticker();

  // A new round clears the form. After a reload mid-round, pick up whatever the server kept.
  $effect(() => {
    if (view?.phase !== 'playing' || view.round === roundShown) return;
    roundShown = view.round;
    autoLocked = false;
    untrack(() => {
      answer = game.you?.answer ?? '';
      useDouble = game.you?.useDouble ?? false;
      lockedLocally = false;
    });
  });

  // When time runs out, lock in whatever has been typed.
  $effect(() => {
    if (view?.phase !== 'playing' || locked || autoLocked || game.deadline === null) return;
    if (ticker.now >= game.deadline) {
      autoLocked = true;
      lockIn();
    }
  });

  function sendDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => game.draft(answer, useDouble), 250);
  }

  function lockIn(event?: SubmitEvent) {
    event?.preventDefault();
    if (locked) return;
    clearTimeout(draftTimer);
    game.lock(answer.trim(), useDouble);
    lockedLocally = true;
  }

  const verdict = {
    hit: { title: 'On the list!', tone: 'bg-green-900/50 ring-green-500' },
    tension: { title: 'TENSION!', tone: 'bg-red-900/60 ring-red-500' },
    miss: { title: 'Not on the list', tone: 'bg-gray-700 ring-gray-500' },
  } as const;
</script>

<svelte:head><title>Tension · {code}</title></svelte:head>

<div class="mx-auto max-w-md space-y-4">
  {#if problem}
    <div class="card mt-16 space-y-4 text-center">
      <p class="text-red-400">{problem}</p>
      <a class="btn btn-primary" href="/join?code={code}">Back to join</a>
    </div>
  {:else if !view}
    <p class="mt-16 text-center text-xl text-gray-400">Joining {code}…</p>
  {:else}
    <header class="flex items-center justify-between text-sm text-gray-400">
      <span class="font-mono">{view.code}</span>
      <span class="truncate px-2 font-semibold text-white">{me?.name}</span>
      <span>{me?.score ?? 0} pts</span>
    </header>

    {#if view.phase === 'lobby'}
      <div class="card text-center">
        <h1 class="mb-2 text-2xl font-bold">You're in!</h1>
        <p class="text-gray-400">The game starts when the host is ready. Watch the main screen.</p>
        <ul class="mt-6 flex flex-wrap justify-center gap-2">
          {#each view.players as player (player.id)}
            <li class={['rounded-full px-3 py-1 text-sm', player.id === me?.id ? 'bg-red-500' : 'bg-gray-700']}>
              {player.name}
            </li>
          {/each}
        </ul>
      </div>
    {:else if view.phase === 'playing' && view.question}
      <div class="flex items-center justify-between gap-4">
        <span class="shrink-0 text-gray-400">Round {view.round}/{view.totalRounds}</span>
        <div class="w-32"><Countdown deadline={game.deadline} totalSeconds={view.settings.timePerRound} /></div>
      </div>

      <div class="card text-center">
        <p class="mb-1 text-xs tracking-wide text-red-400 uppercase">{view.question.category}</p>
        <h1 class="text-xl font-bold text-balance">{view.question.text}</h1>
        <p class="mt-2 text-sm text-gray-400">
          {view.question.tensionCount} tension answers lurking below the top {view.question.cutoff}
        </p>
      </div>

      {#if locked}
        <div class="card text-center">
          <div class="mb-2 text-5xl">🔒</div>
          <h2 class="text-2xl font-bold">Locked in</h2>
          <p class="mt-2 text-lg">{answer.trim() ? `“${answer.trim()}”` : 'No answer'}</p>
          {#if useDouble && answer.trim()}<p class="mt-2 font-bold text-red-400">DOUBLE 🔥</p>{/if}
          <p class="mt-4 text-sm text-gray-400">Waiting for everyone else…</p>
        </div>
      {:else}
        <form class="card space-y-4" onsubmit={lockIn}>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input text-center text-xl"
            bind:value={answer}
            oninput={sendDraft}
            placeholder="Your answer"
            maxlength={MAX_ANSWER_LENGTH}
            autocomplete="off"
            enterkeyhint="done"
            autofocus
          />
          {#if (me?.doublesRemaining ?? 0) > 0}
            <label class="flex cursor-pointer items-center justify-center gap-3">
              <input
                type="checkbox"
                class="size-6 accent-red-500"
                bind:checked={useDouble}
                onchange={() => game.draft(answer, useDouble)}
              />
              <span>
                Double it 🔥
                <span class="block text-xs text-gray-400">
                  ×{DOUBLE_MULTIPLIER}, good or bad · {me?.doublesRemaining} left
                </span>
              </span>
            </label>
          {/if}
          <button class="btn btn-primary w-full py-4 text-lg" disabled={!answer.trim()}>Lock in</button>
        </form>
      {/if}
    {:else if view.phase === 'reveal'}
      {#if myResult}
        {@const shown = verdict[myResult.outcome]}
        <div class={['card text-center ring-2', shown.tone]}>
          <p class="text-sm text-gray-300">{myResult.answer ? `“${myResult.answer}”` : 'No answer'}</p>
          <h1 class="my-2 text-3xl font-black">{myResult.answer ? shown.title : 'Too slow!'}</h1>
          {#if myResult.rank}<p class="text-gray-300">Ranked #{myResult.rank}</p>{/if}
          <p class="mt-2 text-4xl font-bold">{myResult.points > 0 ? '+' : ''}{myResult.points}</p>
          {#if myResult.doubled}<p class="text-sm text-red-300">doubled 🔥</p>{/if}
        </div>
      {/if}
      <div class="card">
        <h2 class="mb-3 font-semibold">Standings</h2>
        <Standings players={view.players} results={view.reveal?.results} highlight={me?.id} />
      </div>
      <p class="text-center text-sm text-gray-400">The full answer list is on the main screen.</p>
    {:else if view.phase === 'finished'}
      <FinalStandings players={view.players} highlight={me?.id} />
      <div class="text-center"><a href="/" class="btn btn-primary">Play again</a></div>
    {:else}
      <p class="card text-center text-gray-400">The host is getting the next round ready…</p>
    {/if}
  {/if}
</div>
