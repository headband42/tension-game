<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { socketStore } from '$lib/socket';

  let code = '';
  let name = '';
  let loading = false;
  let error = '';

  onMount(() => {
    // Load saved name if available
    const savedName = localStorage.getItem('playerName');
    if (savedName) name = savedName;
  });

  async function joinGame() {
    if (!code.trim()) {
      error = 'Please enter a game code';
      return;
    }
    if (!name.trim()) {
      error = 'Please enter your name';
      return;
    }

    loading = true;
    error = '';

    // Save name for future
    localStorage.setItem('playerName', name);

    // Generate or retrieve device ID
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      // Fallback for HTTP (crypto.randomUUID requires HTTPS or localhost)
      deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      localStorage.setItem('deviceId', deviceId);
    }

    // Connect socket and join game
    socketStore.connect();
    socketStore.clearError();

    // Wait for connection (poll up to ~3s)
    for (let i = 0; i < 15; i++) {
      if (get(socketStore).isConnected) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    socketStore.joinGame(code.toUpperCase().trim(), name.trim(), deviceId);

    // Wait for join confirmation with timeout
    let timeoutId: ReturnType<typeof setTimeout>;
    const unsubscribe = socketStore.subscribe((state) => {
      if (state.gameState.code && state.gameState.gameId) {
        clearTimeout(timeoutId);
        unsubscribe();
        goto(`/game/${state.gameState.code}`);
      }
      if (state.error) {
        clearTimeout(timeoutId);
        unsubscribe();
        error = state.error;
        loading = false;
      }
    });

    timeoutId = setTimeout(() => {
      unsubscribe();
      error = 'Connection timeout - please try again';
      loading = false;
    }, 10000);
  }
</script>

<div class="min-h-screen flex flex-col items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <h1 class="text-3xl font-bold text-center mb-8">Join Game</h1>

    <div class="card space-y-4">
      <div>
        <label class="block text-sm font-medium mb-2">Game Code</label>
        <input
          type="text"
          bind:value={code}
          placeholder="TENSION-123"
          class="input text-center text-xl tracking-wider uppercase"
          maxlength="20"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">Your Name</label>
        <input
          type="text"
          bind:value={name}
          placeholder="Enter your name"
          class="input"
          maxlength="20"
        />
      </div>

      {#if error}
        <div class="text-tension-400 text-sm text-center">{error}</div>
      {/if}

      <button
        on:click={joinGame}
        disabled={loading}
        class="btn-primary w-full"
      >
        {loading ? 'Joining...' : 'Join Game'}
      </button>
    </div>

    <div class="mt-6 text-center">
      <a href="/" class="text-gray-400 hover:text-white transition-colors">
        ← Back
      </a>
    </div>
  </div>
</div>
