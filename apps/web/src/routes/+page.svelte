<script lang="ts">
  import { goto } from '$app/navigation';

  function createGame() {
    goto('/host/setup');
  }

  function joinGame() {
    goto('/join');
  }
</script>

<div class="min-h-screen flex flex-col items-center justify-center p-4">
  <div class="text-center mb-12">
    <h1 class="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-tension-400 to-red-600 mb-4">
      TENSION
    </h1>
    <p class="text-xl text-gray-400">The party game of risky answers</p>
  </div>

  <div class="flex flex-col gap-4 w-full max-w-sm">
    <button on:click={createGame} class="btn-primary text-lg py-4">
      Create Game
    </button>
    <button on:click={joinGame} class="btn-secondary text-lg py-4">
      Join Game
    </button>
  </div>

  <div class="mt-16 text-center text-gray-500 text-sm">
    <p>How to play:</p>
    <p class="mt-2">Answer with the top 10 answers to earn points.</p>
    <p>Answers #11+ cost you points (TENSION!).</p>
    <p>Wrong answers cost you points.</p>
    <p class="mt-2 font-semibold">Use your DOUBLE wisely!</p>
  </div>
</div>
