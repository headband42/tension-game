<script lang="ts">
  import type { CategoryNode } from '@tension/shared';
  import { SvelteSet } from 'svelte/reactivity';
  import CategoryTree from './CategoryTree.svelte';

  let { nodes, selected, depth = 0 }: { nodes: CategoryNode[]; selected: SvelteSet<string>; depth?: number } =
    $props();

  /** Categories whose sub-categories are shown. The bank has hundreds, so they start folded. */
  const open = new SvelteSet<string>();

  /** This category and its descendants, limited to those holding questions of their own. */
  function selectable(node: CategoryNode): string[] {
    return [...(node.ownQuestions > 0 ? [node.id] : []), ...node.children.flatMap(selectable)];
  }

  function stateOf(node: CategoryNode): 'all' | 'some' | 'none' {
    const ids = selectable(node);
    const count = ids.filter((id) => selected.has(id)).length;
    return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
  }

  function toggle(node: CategoryNode) {
    const select = stateOf(node) !== 'all';
    for (const id of selectable(node)) {
      if (select) selected.add(id);
      else selected.delete(id);
    }
  }

  function fold(node: CategoryNode) {
    if (open.has(node.id)) open.delete(node.id);
    else open.add(node.id);
  }
</script>

<ul class={['space-y-1', depth > 0 && 'ml-6']}>
  {#each nodes as node (node.id)}
    {@const state = stateOf(node)}
    {@const isOpen = open.has(node.id)}
    <li>
      <div class="flex items-center gap-1">
        {#if node.children.length > 0}
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-700"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} ${node.name} sub-categories`}
            onclick={() => fold(node)}
          >
            <span class={['inline-block transition-transform', isOpen && 'rotate-90']}>▸</span>
          </button>
        {:else}
          <span class="size-8 shrink-0"></span>
        {/if}
        <label class="flex flex-1 cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-gray-700">
          <input
            type="checkbox"
            class="size-5 accent-red-500"
            checked={state === 'all'}
            indeterminate={state === 'some'}
            onchange={() => toggle(node)}
          />
          <span class="flex-1">{node.name}</span>
          <span class="text-sm text-gray-400">{node.totalQuestions}</span>
        </label>
      </div>
      {#if node.children.length > 0 && isOpen}
        <CategoryTree nodes={node.children} {selected} depth={depth + 1} />
      {/if}
    </li>
  {/each}
</ul>
