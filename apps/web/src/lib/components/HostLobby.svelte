<script lang="ts">
  import type { GameView, ServerInfo } from '@tension/shared';
  import { onMount } from 'svelte';
  import { game } from '$lib/game.svelte';

  let { view }: { view: GameView } = $props();

  let origin = $state(location.origin);
  let copied = $state('');
  let starting = $state(false);
  let error = $state('');

  const joinUrl = $derived(`${origin}/join?code=${view.code}`);

  onMount(async () => {
    // A host on localhost would hand out a link phones can't open; swap in the machine's LAN address.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
    try {
      const info: ServerInfo = await (await fetch('/api/info')).json();
      const [address] = info.lanAddresses;
      if (address) origin = `${location.protocol}//${address}${location.port ? `:${location.port}` : ''}`;
    } catch {
      // Keep the localhost link; the code alone is still enough to join.
    }
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      copied = 'Link copied';
    } catch {
      // The Clipboard API needs HTTPS; fall back to selecting the text for a manual copy.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('join-url')!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      copied = 'Selected — press Ctrl+C / ⌘C to copy';
    }
    setTimeout(() => (copied = ''), 3000);
  }

  async function start() {
    starting = true;
    error = '';
    const result = await game.start();
    if (!result.ok) error = result.error;
    starting = false;
  }
</script>

<div class="mx-auto max-w-3xl space-y-6 text-center">
  <div class="card">
    <p class="text-gray-400">Join on your phone with code</p>
    <p class="my-2 font-mono text-7xl font-black tracking-[0.2em] text-red-400 sm:text-8xl">{view.code}</p>
    <p class="text-gray-400">
      at <span id="join-url" class="font-mono text-white select-all">{joinUrl}</span>
    </p>
    <button class="btn btn-secondary mt-4 text-sm" onclick={copyLink}>{copied || 'Copy join link'}</button>
  </div>

  <div class="card text-left">
    <h2 class="mb-4 text-xl font-semibold">Players ({view.players.length})</h2>
    {#if view.players.length === 0}
      <p class="text-gray-400">Waiting for players to join…</p>
    {:else}
      <ul class="flex flex-wrap gap-2">
        {#each view.players as player (player.id)}
          <li class="flex items-center gap-2 rounded-full bg-gray-700 px-4 py-2">
            <span class={['size-2.5 rounded-full', player.connected ? 'bg-green-400' : 'bg-red-400']}></span>
            {player.name}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <p class="text-sm text-gray-400">
    {view.totalRounds} rounds · {view.settings.timePerRound}s to answer ·
    {view.settings.doublesPerPlayer} double{view.settings.doublesPerPlayer === 1 ? '' : 's'} each
  </p>

  {#if error}<p class="text-red-400">{error}</p>{/if}

  <button class="btn btn-success px-12 py-4 text-lg" onclick={start} disabled={starting || view.players.length === 0}>
    {starting ? 'Starting…' : 'Start game'}
  </button>
</div>
