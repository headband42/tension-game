<script lang="ts">
  import { MIN_TENSION_ANSWERS, TENSION_PENALTY, type AdminQuestion } from '@tension/shared';

  let {
    question,
    categoryNames,
    showAnswers,
    busy,
    onedit,
    oncopy,
    ontoggle,
    ondelete,
    oncategory,
    ontag,
  }: {
    question: AdminQuestion;
    /** Display names by category path, for the breadcrumb. */
    categoryNames: Map<string, string>;
    showAnswers: boolean;
    busy: boolean;
    onedit: () => void;
    oncopy: () => void;
    ontoggle: () => void;
    ondelete: () => void;
    oncategory: (path: string) => void;
    ontag: (tag: string) => void;
  } = $props();

  const tension = $derived(question.answers.length - question.cutoff);
  const crumbs = $derived(
    question.category.split('/').map((slug, depth, slugs) => {
      const path = slugs.slice(0, depth + 1).join('/');
      return { path, name: categoryNames.get(path) ?? slug };
    }),
  );
  /** Sources built with wiki_tables.py read "URL | table 1 | name: …"; link the URL. */
  const source = $derived.by(() => {
    const [first, ...recipe] = (question.source ?? '').split(' | ');
    return /^https?:\/\/\S+$/.test(first) ? { url: first, rest: recipe.join(' | ') } : { url: null, rest: question.source };
  });
</script>

<article class={['card space-y-4 p-5', !question.active && 'opacity-70']}>
  <header class="flex flex-wrap items-start gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1 basis-80">
      <nav class="mb-1 flex flex-wrap items-center gap-1 text-xs text-gray-400" aria-label="Category">
        {#each crumbs as crumb, i (crumb.path)}
          {#if i > 0}<span aria-hidden="true">›</span>{/if}
          <button type="button" class="hover:text-white hover:underline" onclick={() => oncategory(crumb.path)}>{crumb.name}</button>
        {/each}
      </nav>
      <h2 class="text-lg leading-snug font-semibold">{question.question}</h2>
    </div>
    <div class="flex shrink-0 flex-wrap gap-2">
      <button type="button" class="btn btn-secondary btn-sm" onclick={onedit} disabled={busy}>Edit</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick={oncopy} disabled={busy} title="Start a new question from this one">
        Copy
      </button>
      <button type="button" class="btn btn-secondary btn-sm" onclick={ontoggle} disabled={busy}>
        {question.active ? 'Deactivate' : 'Activate'}
      </button>
      {#if question.games === 0}
        <button type="button" class="btn btn-secondary btn-sm text-red-300" onclick={ondelete} disabled={busy}>Delete</button>
      {/if}
    </div>
  </header>

  <div class="flex flex-wrap gap-2 text-xs">
    {#if !question.active}
      <span class="rounded-full bg-gray-600 px-2.5 py-0.5 font-semibold">Inactive</span>
    {/if}
    {#if tension < MIN_TENSION_ANSWERS}
      <span class="rounded-full bg-yellow-600 px-2.5 py-0.5 font-semibold" title="Games skip questions with fewer than {MIN_TENSION_ANSWERS} tension answers">
        Unplayable
      </span>
    {/if}
    <span class="rounded-full bg-gray-700 px-2.5 py-0.5">Top {question.cutoff}</span>
    <span class="rounded-full bg-gray-700 px-2.5 py-0.5">{tension} tension</span>
    <span class="rounded-full bg-gray-700 px-2.5 py-0.5">Difficulty {question.difficulty}</span>
    <span class="rounded-full bg-gray-700 px-2.5 py-0.5" title="Games draw the least-played questions first">
      Played {question.usageCount}×
    </span>
    {#if question.submitter}
      <span class="rounded-full bg-gray-700 px-2.5 py-0.5">By {question.submitter}</span>
    {/if}
    {#each question.tags as tag (tag)}
      <button type="button" class="rounded-full bg-gray-900 px-2.5 py-0.5 text-gray-300 hover:bg-gray-700" onclick={() => ontag(tag)}>
        #{tag}
      </button>
    {/each}
  </div>

  {#if showAnswers}
    <table class="w-full text-sm">
      <thead class="sr-only">
        <tr><th>Rank</th><th>Answer</th><th>Figure</th><th>Also accepted</th></tr>
      </thead>
      <tbody>
        {#each question.answers as answer, i (i)}
          {#if i === question.cutoff}
            <tr>
              <td colspan="4" class="pt-3 pb-1 text-xs font-semibold tracking-wide text-red-400 uppercase">
                Tension answers · {TENSION_PENALTY} each
              </td>
            </tr>
          {/if}
          <tr class={['border-t border-gray-700/60 align-top', i >= question.cutoff && 'bg-red-500/10']}>
            <td class="w-10 py-1.5 pl-2 text-gray-400 tabular-nums">{i + 1}</td>
            <td class="py-1.5 pr-4 font-medium">{answer.answer}</td>
            <td class="py-1.5 pr-4 whitespace-nowrap text-gray-300 tabular-nums">{answer.display ?? ''}</td>
            <td class="hidden py-1.5 pr-2 text-gray-400 sm:table-cell">{answer.aliases.join(' · ')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if question.source}
    <p class="text-xs break-words text-gray-400">
      Source:
      {#if source.url}<a href={source.url} target="_blank" rel="noreferrer" class="text-gray-300 underline hover:text-white">{source.url}</a>{/if}
      {source.url && source.rest ? ' | ' : ''}{source.rest}
    </p>
  {/if}
</article>
