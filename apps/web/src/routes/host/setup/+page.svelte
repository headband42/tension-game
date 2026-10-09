<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { v4 as uuidv4 } from 'uuid';

  let categories: any[] = [];
  let selectedCategories: Set<string> = new Set();
  let totalRounds = 5;
  let timePerRound = 45;
  let doublesPerPlayer = 1;
  let waitForReconnects = true;
  let loading = false;

  onMount(async () => {
    const res = await fetch('/api/categories');
    const data = await res.json();
    categories = Array.isArray(data) ? data : data.categories;
  });

  function collectIds(cat: any, into: string[] = []): string[] {
    into.push(cat.id);
    if (cat.children) {
      for (const child of cat.children) collectIds(child, into);
    }
    return into;
  }

  function toggleCategory(cat: any) {
    const ids = collectIds(cat);
    const isSelected = selectedCategories.has(cat.id);

    if (isSelected) {
      // Uncheck this node and all descendants (do not re-toggle unchecked kids)
      for (const id of ids) selectedCategories.delete(id);
    } else {
      for (const id of ids) selectedCategories.add(id);
    }
    selectedCategories = selectedCategories; // Trigger reactivity
  }

  function isPartiallySelected(cat: any): boolean {
    if (!cat.children || cat.children.length === 0) return false;
    const selectedChildren = cat.children.filter((c: any) => selectedCategories.has(c.id));
    return selectedChildren.length > 0 && selectedChildren.length < cat.children.length;
  }

  async function createGame() {
    if (selectedCategories.size === 0) {
      alert('Please select at least one category');
      return;
    }

    loading = true;

    try {
      const hostId = uuidv4();
      localStorage.setItem('hostId', hostId);

      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          totalRounds,
          timePerRound,
          doublesPerPlayer,
          waitForReconnects,
          selectedCategories: Array.from(selectedCategories),
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(`Error: ${data.error || 'Failed to create game'}`);
        return;
      }

      if (data.game) {
        goto(`/host/${data.game.code}`);
      } else {
        alert('Error: No game data returned');
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen p-6">
  <div class="max-w-4xl mx-auto">
    <h1 class="text-3xl font-bold mb-8">Create Game</h1>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Categories -->
      <div class="card">
        <h2 class="text-xl font-semibold mb-4">Select Categories</h2>
        <div class="space-y-2 max-h-80 overflow-y-auto">
          {#each categories as category}
            <div class="space-y-1">
              <button
                on:click={() => toggleCategory(category)}
                class="flex items-center gap-3 w-full p-2 rounded hover:bg-gray-700 transition-colors"
              >
                <div class="w-5 h-5 rounded border-2 flex items-center justify-center
                  {selectedCategories.has(category.id) ? 'bg-tension-500 border-tension-500' : 
                   isPartiallySelected(category) ? 'border-tension-500 bg-gray-700' : 'border-gray-500'}">
                  {#if selectedCategories.has(category.id)}
                    <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  {:else if isPartiallySelected(category)}
                    <div class="w-2 h-0.5 bg-tension-500"></div>
                  {/if}
                </div>
                <span class="flex-1 text-left">{category.name}</span>
                <span class="text-sm text-gray-400">({category._count?.questions || 0})</span>
              </button>
              
              {#if category.children}
                <div class="ml-6 space-y-1">
                  {#each category.children as child}
                    <button
                      on:click={() => toggleCategory(child)}
                      class="flex items-center gap-3 w-full p-2 rounded hover:bg-gray-700 transition-colors text-sm"
                    >
                      <div class="w-4 h-4 rounded border-2 flex items-center justify-center
                        {selectedCategories.has(child.id) ? 'bg-tension-500 border-tension-500' : 'border-gray-500'}">
                        {#if selectedCategories.has(child.id)}
                          <svg class="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                          </svg>
                        {/if}
                      </div>
                      <span class="flex-1 text-left">{child.name}</span>
                      <span class="text-xs text-gray-400">({child._count?.questions || 0})</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Settings -->
      <div class="card">
        <h2 class="text-xl font-semibold mb-4">Game Settings</h2>
        
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium mb-2">
              Rounds: {totalRounds}
            </label>
            <input
              type="range"
              min="1"
              max="20"
              bind:value={totalRounds}
              class="w-full accent-tension-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">
              Time per Round: {timePerRound}s
            </label>
            <input
              type="range"
              min="10"
              max="120"
              step="5"
              bind:value={timePerRound}
              class="w-full accent-tension-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">
              Doubles per Player: {doublesPerPlayer}
            </label>
            <input
              type="range"
              min="0"
              max="5"
              bind:value={doublesPerPlayer}
              class="w-full accent-tension-500"
            />
          </div>

          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={waitForReconnects}
              class="w-5 h-5 rounded accent-tension-500"
            />
            <span>Wait for disconnected players</span>
          </label>
        </div>
      </div>
    </div>

    <div class="mt-8 text-center">
      <button
        on:click={createGame}
        disabled={loading || selectedCategories.size === 0}
        class="btn-primary text-lg px-12 py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Creating...' : 'Create Game'}
      </button>
    </div>
  </div>
</div>
