<script lang="ts">
  import type { AdminCategory } from '@tension/shared';
  import { SvelteSet } from 'svelte/reactivity';
  import CategoryFilter from './CategoryFilter.svelte';

  let {
    nodes,
    selected,
    onselect,
    depth = 0,
  }: { nodes: AdminCategory[]; selected?: string; onselect: (id: string | undefined) => void; depth?: number } = $props();

  /** Categories whose sub-categories are shown. */
  const open = new SvelteSet<string>();

  // Unfold the way to the selected category, wherever the selection came from.
  $effect(() => {
    for (const node of nodes) if (selected?.startsWith(`${node.id}/`)) open.add(node.id);
  });

  function fold(node: AdminCategory) {
    if (open.has(node.id)) open.delete(node.id);
    else open.add(node.id);
  }
</script>

<ul class={[depth > 0 && 'ml-3 border-l border-gray-800 pl-1']}>
  {#each nodes as node (node.id)}
    {@const isOpen = open.has(node.id)}
    {@const isSelected = selected === node.id}
    <li>
      <div class={['flex items-center rounded-md', isSelected ? 'bg-red-500/20 text-white' : 'text-gray-300 hover:bg-gray-800']}>
        {#if node.children.length > 0}
          <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:text-white"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} ${node.name} sub-categories`}
            onclick={() => fold(node)}
          >
            <span class={['inline-block text-xs transition-transform', isOpen && 'rotate-90']}>▸</span>
          </button>
        {:else}
          <span class="size-7 shrink-0"></span>
        {/if}
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left text-sm"
          aria-pressed={isSelected}
          title={node.active ? undefined : 'Inactive: games never draw questions from this category'}
          onclick={() => onselect(isSelected ? undefined : node.id)}
        >
          <span class={['flex-1 truncate', !node.active && 'text-gray-500 italic']}>{node.name}</span>
          <span class="text-xs text-gray-500 tabular-nums">{node.questions}</span>
        </button>
      </div>
      {#if node.children.length > 0 && isOpen}
        <CategoryFilter nodes={node.children} {selected} {onselect} depth={depth + 1} />
      {/if}
    </li>
  {/each}
</ul>
