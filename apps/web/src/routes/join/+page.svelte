<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CODE_LENGTH, MAX_NAME_LENGTH, normalizeCode } from '@tension/shared';
  import { game } from '$lib/game.svelte';
  import { saveName, savedName } from '$lib/storage';

  let code = $state(normalizeCode(page.url.searchParams.get('code') ?? ''));
  let name = $state(savedName());
  let joining = $state(false);
  let error = $state('');

  async function join(event: SubmitEvent) {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) return void (error = `Game codes are ${CODE_LENGTH} characters`);
    if (!name.trim()) return void (error = 'Enter your name');

    joining = true;
    error = '';
    saveName(name.trim());
    const result = await game.joinGame(code, name.trim());
    if (result.ok) {
      await goto(`/play/${code}`);
    } else {
      error = result.error;
      joining = false;
    }
  }
</script>

<div class="mx-auto mt-[10dvh] w-full max-w-sm">
  <h1 class="mb-8 text-center text-3xl font-bold">Join game</h1>

  <form class="card space-y-4" onsubmit={join}>
    <label class="block">
      <span class="label">Game code</span>
      <input
        class="input text-center font-mono text-2xl tracking-[0.3em] uppercase"
        value={code}
        oninput={(e) => (code = normalizeCode(e.currentTarget.value))}
        placeholder="ABCD"
        maxlength={CODE_LENGTH}
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <label class="block">
      <span class="label">Your name</span>
      <input class="input" bind:value={name} placeholder="Your name" maxlength={MAX_NAME_LENGTH} autocomplete="nickname" />
    </label>

    {#if error}<p class="text-center text-sm text-red-400">{error}</p>{/if}

    <button class="btn btn-primary w-full" disabled={joining}>{joining ? 'Joining…' : 'Join game'}</button>
  </form>

  <p class="mt-6 text-center"><a href="/" class="text-gray-400 transition-colors hover:text-white">← Back</a></p>
</div>
