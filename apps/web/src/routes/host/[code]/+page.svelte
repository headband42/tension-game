<script lang="ts">
  import { page } from '$app/state';
  import { normalizeCode } from '@tension/shared';
  import { untrack } from 'svelte';
  import FinalStandings from '$lib/components/FinalStandings.svelte';
  import HostLobby from '$lib/components/HostLobby.svelte';
  import HostReveal from '$lib/components/HostReveal.svelte';
  import HostRound from '$lib/components/HostRound.svelte';
  import { game } from '$lib/game.svelte';
  import { hostToken } from '$lib/storage';

  const code = $derived(normalizeCode(page.params.code ?? ''));
  let notHost = $state(false);
  let problem = $state<string | null>(null);

  async function connect(target: string) {
    if (game.isSeated('host', target)) return;
    const token = hostToken(target);
    notHost = !token;
    problem = null;
    if (!token) return;
    const result = await game.hostGame(target, token);
    if (!result.ok && target === code) problem = result.error;
  }

  $effect(() => {
    const target = code;
    untrack(() => void connect(target));
  });

  const view = $derived(game.isSeated('host', code) ? game.game : null);
</script>

<svelte:head><title>Tension · {code}</title></svelte:head>

{#if notHost}
  <div class="card mx-auto mt-16 max-w-md space-y-4 text-center">
    <h1 class="text-2xl font-bold">Game {code}</h1>
    <p class="text-gray-400">This browser didn't create this game, so it can't be the host screen.</p>
    <div class="flex justify-center gap-3">
      <a class="btn btn-primary" href="/join?code={code}">Join as a player</a>
      <a class="btn btn-secondary" href="/host">New game</a>
    </div>
  </div>
{:else if problem}
  <div class="card mx-auto mt-16 max-w-md space-y-4 text-center">
    <p class="text-red-400">{problem}</p>
    <a class="btn btn-secondary" href="/">Home</a>
  </div>
{:else if !view}
  <p class="mt-16 text-center text-2xl text-gray-400">Connecting…</p>
{:else if view.phase === 'lobby'}
  <HostLobby {view} />
{:else if view.phase === 'playing'}
  <HostRound {view} />
{:else if view.phase === 'reveal'}
  <HostReveal {view} />
{:else}
  <div class="mx-auto max-w-2xl space-y-8">
    <FinalStandings players={view.players} />
    <div class="text-center"><a href="/host" class="btn btn-primary">New game</a></div>
  </div>
{/if}
