<script lang="ts">
  import { DOUBLE_MULTIPLIER, MISS_PENALTY, TENSION_PENALTY } from '@tension/shared';
</script>

<div class="flex min-h-[90dvh] flex-col items-center justify-center">
  <div class="mb-12 text-center">
    <h1 class="mb-4 bg-gradient-to-r from-red-400 to-red-600 bg-clip-text text-6xl font-black text-transparent">
      TENSION
    </h1>
    <p class="text-xl text-gray-400">The party game of risky answers</p>
  </div>

  <div class="flex w-full max-w-sm flex-col gap-4">
    <a href="/host" class="btn btn-primary py-4 text-lg">Create game</a>
    <a href="/join" class="btn btn-secondary py-4 text-lg">Join game</a>
  </div>

  <div class="mt-16 max-w-md space-y-2 text-center text-sm text-gray-400">
    <p class="font-semibold text-gray-300">How to play</p>
    <p>Each question has a ranked list. Name something in the top 10 and score its rank: #1 is worth 1, #10 is worth 10.</p>
    <p>Too obscure and you hit the tension zone below the top 10 ({TENSION_PENALTY}). Not on the list at all: {MISS_PENALTY}.</p>
    <p class="font-semibold text-gray-300">Use your DOUBLE wisely — it multiplies points ×{DOUBLE_MULTIPLIER}, good or bad.</p>
  </div>
</div>
