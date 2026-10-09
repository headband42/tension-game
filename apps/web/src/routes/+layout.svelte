<script lang="ts">
  import '../app.css';
  import { game } from '$lib/game.svelte';

  let { children } = $props();
</script>

{#if game.session && !game.connected}
  <div class="sticky top-0 z-10 bg-yellow-600 px-4 py-2 text-center text-sm font-medium">Reconnecting…</div>
{:else if game.error}
  <div class="sticky top-0 z-10 bg-red-700 px-4 py-2 text-center text-sm font-medium">{game.error}</div>
{/if}

<main class="min-h-dvh p-4 sm:p-6">
  {@render children()}
</main>
