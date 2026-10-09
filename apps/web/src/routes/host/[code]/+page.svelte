<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { socketStore } from '$lib/socket';

  const gameCode = $page.params.code as string;
  let gameId: string | null = null;
  let loading = true;
  let error = '';
  let copyMsg = '';
  let starting = false;

  $: gameState = $socketStore.gameState;
  $: players = gameState.players.length
    ? gameState.players
    : [];
  $: disconnectedCount = players.filter((p) => !p.connected).length;

  let navigatedToGame = false;

  // Navigate to game screen when host starts / game becomes active
  $: if (
    !loading &&
    !navigatedToGame &&
    gameState.isHost &&
    (gameState.status === 'active' || gameState.status === 'completed')
  ) {
    navigatedToGame = true;
    goto(`/game/${gameCode}`);
  }

  onMount(async () => {
    try {
      const res = await fetch(`/api/games/${gameCode}`);
      const data = await res.json();

      if (!data.game) {
        goto('/');
        return;
      }

      gameId = data.game.id;
      loading = false;

      // Seed players from REST until socket syncs
      if (data.game.players?.length) {
        // Will be overwritten by game:state from host:join
      }

      const hostId = localStorage.getItem('hostId') || undefined;

      socketStore.connect();
      // Small delay so socket is connecting
      setTimeout(() => {
        if (gameId) socketStore.hostJoin(gameId, hostId);
      }, 200);
    } catch (e: any) {
      error = e?.message || 'Failed to load game';
      loading = false;
    }
  });

  function startGame() {
    if (players.length < 1) {
      alert('Need at least 1 player to start');
      return;
    }
    starting = true;
    error = '';
    socketStore.clearError();
    socketStore.startGame();
  }

  // Surface server errors
  $: if ($socketStore.error) {
    error = $socketStore.error;
    starting = false;
  }

  async function copyCode() {
    copyMsg = '';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(gameCode);
        copyMsg = 'Copied!';
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch {
      // Fallback: select a temporary input
      const el = document.createElement('textarea');
      el.value = gameCode;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
        copyMsg = 'Copied!';
      } catch {
        copyMsg = 'Select and copy: ' + gameCode;
      }
      document.body.removeChild(el);
    }
    setTimeout(() => (copyMsg = ''), 2500);
  }
</script>

<div class="min-h-screen p-6">
  {#if loading}
    <div class="flex items-center justify-center h-screen">
      <div class="text-2xl">Loading...</div>
    </div>
  {:else}
    <div class="max-w-2xl mx-auto text-center">
      <h1 class="text-4xl font-bold mb-2">Waiting Room</h1>

      <div class="card mb-8">
        <p class="text-gray-400 mb-2">Game Code</p>
        <button
          on:click={copyCode}
          class="text-5xl font-mono font-bold text-tension-400 hover:text-tension-300 transition-colors"
        >
          {gameCode}
        </button>
        <p class="text-sm text-gray-500 mt-2">
          {copyMsg || 'Click to copy'}
        </p>
      </div>

      <div class="card mb-8">
        <h2 class="text-xl font-semibold mb-4">
          Players ({players.length})
        </h2>

        {#if players.length === 0}
          <p class="text-gray-500">Waiting for players to join...</p>
        {:else}
          <div class="space-y-2">
            {#each players as player (player.id)}
              <div
                class="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
              >
                <span class="font-medium">{player.name}</span>
                <span class={player.connected ? 'text-green-400' : 'text-red-400'}>
                  {player.connected ? '🟢' : '🔴'}
                </span>
              </div>
            {/each}
          </div>
        {/if}

        {#if disconnectedCount > 0}
          <p class="text-sm text-yellow-400 mt-4">
            {disconnectedCount} player{disconnectedCount === 1 ? '' : 's'} disconnected
          </p>
        {/if}
      </div>

      {#if error}
        <div class="text-tension-400 text-sm mb-4">{error}</div>
      {/if}

      <button
        on:click={startGame}
        disabled={starting || players.length < 1}
        class="btn-success text-lg px-12 py-4 disabled:opacity-50"
      >
        {starting ? 'Starting...' : 'Start Game'}
      </button>
    </div>
  {/if}
</div>
