<script lang="ts">
  let {
    values = $bindable(),
    label,
    placeholder = 'Add…',
  }: { values: string[]; label: string; placeholder?: string } = $props();

  let draft = $state('');

  // Entries are separate chips rather than a comma-separated list: answers like "Goodbye, Mr. Chips" have commas.
  function add() {
    const value = draft.trim();
    if (value && !values.includes(value)) values = [...values, value];
    draft = '';
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && values.length > 0) {
      values = values.slice(0, -1);
    }
  }
</script>

<div
  class="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-gray-600 bg-gray-700 px-1.5 py-1 focus-within:ring-2 focus-within:ring-red-500"
>
  {#each values as value, i (i)}
    <span class="inline-flex items-center gap-1 rounded bg-gray-600 py-0.5 pr-1 pl-2 text-xs">
      {value}
      <button
        type="button"
        class="rounded px-1 text-gray-300 hover:bg-gray-500 hover:text-white"
        aria-label={`Remove ${value}`}
        onclick={() => (values = values.filter((_, j) => j !== i))}
      >
        ×
      </button>
    </span>
  {/each}
  <input
    class="min-w-20 flex-1 bg-transparent px-1 py-0.5 text-sm text-white outline-none placeholder:text-gray-400"
    aria-label={label}
    {placeholder}
    bind:value={draft}
    onkeydown={keydown}
    onblur={add}
  />
</div>
