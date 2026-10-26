<script lang="ts">
  import {
    MAX_TENSION_ANSWERS,
    MIN_TENSION_ANSWERS,
    TENSION_PENALTY,
    type AnswerInput,
    type QuestionInput,
    type SaveQuestionResponse,
    type ValidationIssue,
  } from '@tension/shared';
  import { onMount, tick, untrack } from 'svelte';
  import { admin, AdminRequestError } from '$lib/admin.svelte';
  import ChipInput from './ChipInput.svelte';

  let {
    id,
    question,
    categoryPaths,
    onclose,
    onsaved,
  }: {
    /** The question being edited; without one, saving adds `question` as a new question. */
    id?: string;
    question: QuestionInput;
    categoryPaths: string[];
    onclose: () => void;
    onsaved: (saved: SaveQuestionResponse, created: boolean) => void;
  } = $props();

  type Row = { key: number; answer: string; display: string; aliases: string[] };
  let nextKey = 0;
  const toRow = (answer?: AnswerInput): Row => ({
    key: nextKey++,
    answer: answer?.answer ?? '',
    display: answer?.display ?? '',
    aliases: [...(answer?.aliases ?? [])],
  });

  // A working copy: the parent mounts a fresh editor for every question it opens.
  const initial = untrack(() => question);
  let text = $state(initial.question);
  let category = $state(initial.category);
  let cutoff = $state(initial.cutoff);
  let difficulty = $state(initial.difficulty);
  let source = $state(initial.source ?? '');
  let submitter = $state(initial.submitter ?? '');
  let tags = $state([...initial.tags]);
  let rows = $state(initial.answers.map(toRow));

  let dialog: HTMLDialogElement;
  let saving = $state(false);
  let error = $state('');
  let issues = $state<ValidationIssue[]>([]);

  /** Rows left completely blank at the end are spares, not answers. */
  const answerCount = $derived(rows.findLastIndex((row) => row.answer.trim() || row.display.trim() || row.aliases.length > 0) + 1);
  const tension = $derived(answerCount - cutoff);
  const tensionOk = $derived(tension >= MIN_TENSION_ANSWERS && tension <= MAX_TENSION_ANSWERS);
  const statedTop = $derived(Number(/\btop (\d+)\b/i.exec(text)?.[1] ?? cutoff));
  const newCategory = $derived(category.trim() !== '' && !categoryPaths.includes(category.trim()));

  /** The question as it would be saved. */
  function draft(): QuestionInput {
    return {
      category: category.trim(),
      question: text.trim(),
      cutoff,
      difficulty,
      submitter: submitter.trim() || undefined,
      source: source.trim() || undefined,
      tags,
      answers: rows.slice(0, answerCount).map((row) => ({
        answer: row.answer.trim(),
        display: row.display.trim() || undefined,
        aliases: row.aliases,
      })),
    };
  }

  const unchanged = JSON.stringify(draft());

  /** Gaps the server would also reject, caught before sending with plainer messages. */
  function gaps(q: QuestionInput): ValidationIssue[] {
    const found: ValidationIssue[] = [];
    if (!q.question) found.push({ path: ['question'], message: 'Write the question' });
    if (!q.category) found.push({ path: ['category'], message: 'Choose a category' });
    q.answers.forEach((answer, i) => {
      if (!answer.answer) found.push({ path: ['answers', i], message: 'This answer is empty. Fill it in or remove the row' });
    });
    return found;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const body = draft();
    issues = gaps(body);
    error = issues.length > 0 ? 'Fix the problems below and save again.' : '';
    if (issues.length > 0) return;

    saving = true;
    try {
      const path = id ? `/questions/${id}` : '/questions';
      onsaved(await admin.request<SaveQuestionResponse>(path, { method: id ? 'PUT' : 'POST', body }), !id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the question';
      issues = e instanceof AdminRequestError ? e.issues : [];
      saving = false;
    }
  }

  function close() {
    if (JSON.stringify(draft()) === unchanged || confirm('Discard your changes to this question?')) onclose();
  }

  // Row numbers in the last save's problems stop lining up once rows move.
  function move(index: number, by: number) {
    [rows[index], rows[index + by]] = [rows[index + by], rows[index]];
    issues = [];
  }

  function removeRow(index: number) {
    rows.splice(index, 1);
    issues = [];
  }

  /** Enter moves to the same box in the next row (adding one at the end) rather than saving half a list. */
  async function nextRow(event: KeyboardEvent, index: number, field: 'answer' | 'display') {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (index === rows.length - 1) rows.push(toRow());
    await tick();
    dialog.querySelector<HTMLInputElement>(`[data-row="${index + 1}"][data-field="${field}"]`)?.focus();
  }

  /** Several pasted lines fill consecutive rows from this one: "answer", or "answer<Tab>figure" from a spreadsheet. */
  function paste(event: ClipboardEvent, index: number) {
    const lines = (event.clipboardData?.getData('text/plain') ?? '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return;
    event.preventDefault();
    lines.forEach((line, offset) => {
      const [answer, display] = line.split('\t').map((cell) => cell.trim());
      if (index + offset >= rows.length) rows.push(toRow());
      rows[index + offset].answer = answer;
      if (display) rows[index + offset].display = display;
    });
  }

  /** Problems with a field (or, given an index, with one answer row). */
  function problemsWith(field: string, index?: number) {
    return issues.filter((issue) => issue.path[0] === field && (index === undefined ? typeof issue.path[1] !== 'number' : issue.path[1] === index));
  }

  const FIELD_NAMES: Record<string, string> = { question: 'Question', category: 'Category', cutoff: 'Cutoff', answers: 'Answers' };

  function where([field, index, part, partIndex]: ValidationIssue['path']) {
    if (field !== 'answers' || typeof index !== 'number') return FIELD_NAMES[field] ?? String(field ?? 'Question');
    const answer = `Answer #${index + 1}`;
    if (part === 'aliases') return `${answer}, alias ${Number(partIndex) + 1}`;
    return part === 'display' ? `${answer}, figure` : answer;
  }

  onMount(() => dialog.showModal());
</script>

{#snippet problems(list: ValidationIssue[])}
  {#each list as issue, i (i)}
    <span class="mt-1 block text-xs text-red-400">{issue.message}</span>
  {/each}
{/snippet}

<dialog
  bind:this={dialog}
  class="m-auto max-h-[calc(100dvh-2rem)] w-[min(72rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-gray-800 p-0 text-white shadow-2xl backdrop:bg-black/70"
  aria-labelledby="question-editor-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <form class="flex max-h-[calc(100dvh-2rem)] flex-col" onsubmit={save} novalidate>
    <header class="flex items-center gap-4 border-b border-gray-700 px-6 py-4">
      <h2 id="question-editor-title" class="text-xl font-semibold">{id ? 'Edit question' : 'New question'}</h2>
      <button type="button" class="ml-auto text-2xl leading-none text-gray-400 hover:text-white" aria-label="Close" onclick={close}>×</button>
    </header>

    <div class="flex-1 space-y-6 overflow-y-auto px-6 py-5">
      <label class="block">
        <span class="label">Question</span>
        <textarea class="input input-sm" rows="2" placeholder="Top 10 highest mountains in the world" bind:value={text}></textarea>
        {@render problems(problemsWith('question'))}
      </label>

      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <label class="block">
          <span class="label">Category</span>
          <input
            class="input input-sm font-mono"
            list="question-editor-categories"
            placeholder="geography/mountains"
            spellcheck="false"
            autocomplete="off"
            bind:value={category}
          />
          {#if newCategory}<span class="mt-1 block text-xs text-gray-400">A new category, created when you save.</span>{/if}
          {@render problems(problemsWith('category'))}
        </label>
        <label class="block">
          <span class="label">Cutoff</span>
          <input class="input input-sm" type="number" min="1" max="20" bind:value={cutoff} />
        </label>
        <label class="block">
          <span class="label">Difficulty</span>
          <select class="input input-sm" bind:value={difficulty}>
            {#each [1, 2, 3, 4, 5] as level (level)}<option value={level}>{level}</option>{/each}
          </select>
        </label>
      </div>
      {#if statedTop !== cutoff}
        <p class="-mt-4 text-xs text-yellow-400">The question says “Top {statedTop}”, so the cutoff should be {statedTop}.</p>
      {/if}
      {@render problems(problemsWith('cutoff'))}

      <section>
        <div class="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 class="text-sm font-medium text-gray-300">Answers, best first</h3>
          <p class={['text-sm', tensionOk ? 'text-gray-400' : 'text-yellow-400']}>
            {answerCount} answer{answerCount === 1 ? '' : 's'}: {Math.min(answerCount, cutoff)} scoring + {Math.max(tension, 0)} tension{tensionOk
              ? ''
              : ` · needs ${cutoff + MIN_TENSION_ANSWERS}–${cutoff + MAX_TENSION_ANSWERS} in all`}
          </p>
        </div>

        <div class="mb-1 hidden gap-2 px-1 text-xs text-gray-500 md:grid md:grid-cols-[2rem_minmax(0,1.2fr)_9rem_minmax(0,1.5fr)_5.5rem]">
          <span></span><span>Answer</span><span>Figure</span><span>Also accepted (Enter adds)</span>
        </div>
        <ol class="space-y-1">
          {#each rows as row, index (row.key)}
            {@const rowProblems = problemsWith('answers', index)}
            {#if index === cutoff}
              <li class="px-1 pt-2 text-xs font-semibold tracking-wide text-red-400 uppercase">Tension answers · {TENSION_PENALTY} each</li>
            {/if}
            <li
              class={[
                'grid grid-cols-[2rem_minmax(0,1fr)_5.5rem] items-start gap-2 rounded-md p-1',
                'md:grid-cols-[2rem_minmax(0,1.2fr)_9rem_minmax(0,1.5fr)_5.5rem]',
                index >= cutoff && index < answerCount && 'bg-red-500/10',
                rowProblems.length > 0 && 'ring-1 ring-red-500',
              ]}
            >
              <span class="pt-1.5 text-right text-sm text-gray-400 tabular-nums">{index + 1}</span>
              <input
                class="input input-sm"
                aria-label={`Answer #${index + 1}`}
                data-row={index}
                data-field="answer"
                bind:value={row.answer}
                onkeydown={(event) => nextRow(event, index, 'answer')}
                onpaste={(event) => paste(event, index)}
              />
              <input
                class="input input-sm col-start-2 md:col-start-auto"
                aria-label={`Figure for answer #${index + 1}`}
                placeholder="Figure"
                data-row={index}
                data-field="display"
                bind:value={row.display}
                onkeydown={(event) => nextRow(event, index, 'display')}
              />
              <div class="col-start-2 md:col-start-auto">
                <ChipInput bind:values={row.aliases} label={`Other accepted names for answer #${index + 1}`} placeholder="Alias…" />
              </div>
              <div class="col-start-3 row-start-1 flex justify-end gap-0.5 md:col-start-auto md:row-start-auto">
                <button
                  type="button"
                  class="size-8 rounded-md text-gray-400 enabled:hover:bg-gray-700 enabled:hover:text-white disabled:opacity-30"
                  aria-label={`Move answer #${index + 1} up`}
                  disabled={index === 0}
                  onclick={() => move(index, -1)}>↑</button
                >
                <button
                  type="button"
                  class="size-8 rounded-md text-gray-400 enabled:hover:bg-gray-700 enabled:hover:text-white disabled:opacity-30"
                  aria-label={`Move answer #${index + 1} down`}
                  disabled={index === rows.length - 1}
                  onclick={() => move(index, 1)}>↓</button
                >
                <button
                  type="button"
                  class="size-8 rounded-md text-gray-400 hover:bg-gray-700 hover:text-red-300"
                  aria-label={`Remove answer #${index + 1}`}
                  onclick={() => removeRow(index)}>×</button
                >
              </div>
              {#if rowProblems.length > 0}
                <div class="col-span-full pl-10">{@render problems(rowProblems)}</div>
              {/if}
            </li>
          {/each}
        </ol>
        <button type="button" class="mt-2 text-sm text-red-400 hover:underline" onclick={() => rows.push(toRow())}>+ Add answer</button>
        {@render problems(problemsWith('answers'))}
        <p class="mt-2 text-xs text-gray-500">
          Enter moves down a row. Pasting a list into an answer box fills several rows at once, one answer per line; a tab
          and a figure after each answer (as copied from a spreadsheet) fill in the figures too.
        </p>
      </section>

      <div class="grid gap-4 md:grid-cols-2">
        <label class="block md:col-span-2">
          <span class="label">Source</span>
          <input class="input input-sm" placeholder="Where the list comes from, ideally a wiki_tables.py recipe" bind:value={source} />
        </label>
        <div>
          <span class="label">Tags</span>
          <ChipInput bind:values={tags} label="Tags" placeholder="Add a tag…" />
        </div>
        <label class="block">
          <span class="label">Submitter</span>
          <input class="input input-sm" bind:value={submitter} />
        </label>
      </div>
    </div>

    <footer class="border-t border-gray-700 px-6 py-4">
      {#if error}
        <div class="mb-3 max-h-32 overflow-y-auto text-sm text-red-400" role="alert">
          <p>{error}</p>
          {#if issues.length > 0}
            <ul class="mt-1 list-disc pl-5">
              {#each issues as issue, i (i)}<li>{where(issue.path)}: {issue.message}</li>{/each}
            </ul>
          {/if}
        </div>
      {/if}
      <div class="flex justify-end gap-3">
        <button type="button" class="btn btn-secondary btn-sm" onclick={close}>Cancel</button>
        <button class="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Add question'}</button>
      </div>
    </footer>
  </form>

  <datalist id="question-editor-categories">
    {#each categoryPaths as path (path)}<option value={path}></option>{/each}
  </datalist>
</dialog>
