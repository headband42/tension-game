<script lang="ts">
  import { Ticker } from '$lib/ticker.svelte';

  let { deadline, totalSeconds, large = false }: { deadline: number | null; totalSeconds: number; large?: boolean } =
    $props();

  const ticker = new Ticker();
  // Clamped so a tab whose timers were throttled never shows more time than the round has.
  const remaining = $derived(
    deadline === null ? 0 : Math.min(totalSeconds, Math.max(0, Math.ceil((deadline - ticker.now) / 1000))),
  );
  const fraction = $derived(totalSeconds > 0 ? Math.min(1, remaining / totalSeconds) : 0);
  const label = $derived(`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
</script>

<div class="w-full" role="timer" aria-label="{remaining} seconds left">
  <div
    class={[
      'text-right font-mono font-bold tabular-nums',
      large ? 'text-6xl' : 'text-3xl',
      remaining <= 10 ? 'text-red-400' : 'text-white',
    ]}
  >
    {label}
  </div>
  <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-700">
    <div
      class={['h-full rounded-full transition-[width] duration-300 ease-linear', remaining <= 10 ? 'bg-red-500' : 'bg-gray-300']}
      style:width="{fraction * 100}%"
    ></div>
  </div>
</div>
