<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { socketStore } from '$lib/socket';

  const gameCode = $page.params.code as string;

  let answer = '';
  let useDouble = false;
  let timeLeft = 0;
  let timerInterval: ReturnType<typeof setInterval> | undefined;
  let hasSubmitted = false;
  let isLocked = false;
  let timerQuestionId: string | null = null;
  let joinedOnce = false;

  $: gameState = $socketStore.gameState;
  $: isHost = gameState.isHost === true;
  $: myPlayerId =
    typeof window !== 'undefined' ? localStorage.getItem('playerId') || '' : '';
  $: myPlayer = gameState.players.find((p) => p.id === myPlayerId);
  $: doublesLeft =
    gameState.doublesRemaining ?? myPlayer?.doublesRemaining ?? 0;
  $: disconnectedPlayers = gameState.players.filter((p) => !p.connected);

  function getDeviceId(): string {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
        /[xy]/g,
        function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }
      );
      localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  }

  onMount(() => {
    socketStore.connect();

    const hostId = localStorage.getItem('hostId');
    const savedName = localStorage.getItem('playerName');
    const deviceId = getDeviceId();

    // Give socket a moment to connect, then attach as host or player
    setTimeout(async () => {
      if (joinedOnce) return;
      joinedOnce = true;

      // Prefer host rejoin when this browser owns the game (verify via API)
      if (hostId) {
        try {
          const res = await fetch(`/api/games/${gameCode}`);
          const data = await res.json();
          if (data.game && data.game.hostId === hostId) {
            socketStore.hostJoin(data.game.id, hostId);
            return;
          }
        } catch {
          // fall through to player join
        }
      }

      // Already marked host in store (navigated from waiting room)
      if (gameState.isHost && gameState.gameId) {
        socketStore.hostJoin(gameState.gameId, hostId || undefined);
        return;
      }

      // Player rejoin with deviceId (never playerId)
      if (savedName) {
        socketStore.joinGame(gameCode, savedName, deviceId);
      }
    }, 300);
  });

  // Reset local answer UI when a new round starts
  $: if (
    gameState.currentQuestion &&
    gameState.currentQuestion.id !== timerQuestionId
  ) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = undefined;
    }
    timerQuestionId = gameState.currentQuestion.id;
    timeLeft = gameState.currentQuestion.timeLimit;
    hasSubmitted = false;
    isLocked = false;
    answer = '';
    useDouble = false;

    timerInterval = setInterval(() => {
      if (timeLeft > 0) {
        timeLeft--;
      } else {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = undefined;
        if (!isLocked && !isHost) {
          lockAnswer();
        }
      }
    }, 1000);
  }

  $: if (gameState.results && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = undefined;
  }

  $: if (gameState.status === 'completed' && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = undefined;
  }

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
  });

  function submitAnswer() {
    if (!answer.trim()) return;
    const wantDouble = useDouble && doublesLeft > 0;
    socketStore.submitAnswer(answer, wantDouble);
    hasSubmitted = true;
    if (!wantDouble) useDouble = false;
  }

  function lockAnswer() {
    if (isLocked || isHost) return;
    if (!hasSubmitted) {
      const wantDouble = useDouble && doublesLeft > 0;
      socketStore.submitAnswer(answer || '', wantDouble);
      hasSubmitted = true;
    }
    socketStore.lockAnswer();
    isLocked = true;
  }

  function nextRound() {
    socketStore.nextRound();
    hasSubmitted = false;
    isLocked = false;
    answer = '';
    useDouble = false;
    timerQuestionId = null;
  }

  // Official top-10 + tension split for reveal
  $: topAnswers =
    gameState.officialAnswers?.filter((a) => a.rank <= 10) ?? [];
  $: tensionAnswers =
    gameState.officialAnswers?.filter((a) => a.rank > 10) ?? [];
</script>

<div class="min-h-screen p-4">
  {#if $socketStore.error}
    <div class="max-w-4xl mx-auto mb-4 text-center text-tension-400 text-sm">
      {$socketStore.error}
    </div>
  {/if}

  {#if !gameState.status}
    <div class="flex items-center justify-center h-screen">
      <div class="text-center">
        <div class="text-2xl mb-4">Connecting...</div>
        <div class="text-sm text-gray-400">
          Socket: {$socketStore.isConnected ? '✅ Connected' : '❌ Disconnected'}
          {#if $socketStore.socket?.id}
            (ID: {$socketStore.socket.id})
          {/if}
        </div>
      </div>
    </div>
  {:else if gameState.status === 'active' && !gameState.results}
    <!-- Active Round -->
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div class="text-lg">
          Round {gameState.currentRound} / {gameState.totalRounds}
        </div>
        <div
          class="text-3xl font-mono font-bold {timeLeft <= 10
            ? 'text-tension-500'
            : 'text-white'}"
        >
          {Math.floor(timeLeft / 60)}:{(timeLeft % 60)
            .toString()
            .padStart(2, '0')}
        </div>
      </div>

      {#if gameState.currentQuestion}
        <div class="card text-center mb-8">
          <div class="text-tension-400 text-sm uppercase tracking-wide mb-2">
            {gameState.currentQuestion.category}
          </div>
          <h2 class="text-2xl md:text-3xl font-bold">
            {gameState.currentQuestion.text}
          </h2>
        </div>
      {/if}

      {#if isHost}
        <div class="card">
          <h3 class="text-xl font-semibold mb-4">Players</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            {#each gameState.players as player (player.id)}
              {@const submission = gameState.submissions.find(
                (s) => s.playerId === player.id
              )}
              <div
                class="p-4 rounded-lg {submission?.locked
                  ? 'bg-green-900/50'
                  : submission?.hasAnswer
                    ? 'bg-yellow-900/50'
                    : !player.connected
                      ? 'bg-red-900/30'
                      : 'bg-gray-700'}"
              >
                <div class="font-medium">
                  {player.name}
                  {#if !player.connected}
                    <span class="text-red-400 text-xs">offline</span>
                  {/if}
                </div>
                <div class="text-sm text-gray-400">
                  {#if submission?.locked}
                    ✓ Locked {submission.usedDouble ? '🔥' : ''}
                  {:else if submission?.hasAnswer}
                    Typing...
                  {:else}
                    Waiting...
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if disconnectedPlayers.length > 0 && gameState.waitForReconnects}
            <div class="mt-4 p-3 bg-yellow-900/30 rounded-lg text-sm">
              Waiting for {disconnectedPlayers.length} disconnected player(s).
              <button
                on:click={() => socketStore.proceedWithout()}
                class="btn-secondary mt-2 w-full text-sm"
              >
                Proceed Without Them
              </button>
            </div>
          {/if}

          <button
            on:click={() => socketStore.endRound()}
            class="btn-primary w-full mt-6"
          >
            End Round Early
          </button>
        </div>
      {:else}
        <div class="max-w-md mx-auto">
          {#if !isLocked}
            <div class="card mb-4 text-center">
              {#if doublesLeft > 0}
                <label
                  class="flex items-center justify-center gap-3 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    bind:checked={useDouble}
                    disabled={hasSubmitted}
                    class="w-6 h-6 rounded accent-tension-500"
                  />
                  <span class="text-lg">
                    Use DOUBLE 🔥
                    <span class="text-sm text-gray-400 block">
                      {doublesLeft} remaining · doubles points (good or bad!)
                    </span>
                  </span>
                </label>
              {:else}
                <span class="text-gray-400 text-sm">No doubles remaining</span>
              {/if}
            </div>

            <div class="card">
              <input
                type="text"
                bind:value={answer}
                placeholder="Your answer..."
                disabled={isLocked}
                class="input text-xl text-center mb-4"
                on:keydown={(e) =>
                  e.key === 'Enter' && !hasSubmitted && submitAnswer()}
              />

              {#if !hasSubmitted}
                <button
                  on:click={submitAnswer}
                  disabled={!answer.trim()}
                  class="btn-secondary w-full mb-2"
                >
                  Submit Answer
                </button>
              {:else}
                <div class="text-center text-green-400 mb-2">
                  Answer submitted!
                </div>
              {/if}

              <button
                on:click={lockAnswer}
                disabled={isLocked}
                class="btn-primary w-full"
              >
                {isLocked ? 'Locked!' : 'LOCK IN'}
              </button>
            </div>
          {:else}
            <div class="card text-center">
              <div class="text-6xl mb-4">✓</div>
              <h3 class="text-2xl font-bold mb-2">Locked In!</h3>
              <p class="text-gray-400">Waiting for other players...</p>
              {#if useDouble && doublesLeft >= 0}
                <div class="mt-4 text-tension-400 font-bold">
                  DOUBLE ACTIVE 🔥
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if gameState.results}
    <!-- Results / Reveal Phase -->
    <div class="max-w-4xl mx-auto">
      <h2 class="text-3xl font-bold text-center mb-8">Round Results</h2>

      <!-- Official answer key -->
      {#if topAnswers.length > 0}
        <div class="card mb-6">
          <h3 class="text-xl font-semibold mb-4">Top 10 Answers</h3>
          <div class="space-y-2">
            {#each topAnswers as ans}
              {@const who = gameState.results?.filter(
                (r) => r.matchedRank === ans.rank
              )}
              <div
                class="flex items-center gap-4 p-3 rounded-lg bg-green-900/20"
              >
                <div
                  class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center font-bold"
                >
                  {ans.rank}
                </div>
                <div class="flex-1">
                  <div class="font-medium">{ans.answer}</div>
                  {#if ans.displayValue}
                    <div class="text-xs text-gray-400">{ans.displayValue}</div>
                  {/if}
                  {#if who && who.length}
                    <div class="text-xs text-green-400 mt-1">
                      {who.map((w) => w.playerName).join(', ')}
                    </div>
                  {/if}
                </div>
                <div class="text-lg font-bold text-green-400">
                  +{ans.rank}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if tensionAnswers.length > 0}
        <div class="card mb-6">
          <h3 class="text-xl font-semibold mb-4 text-tension-400">
            Tension Zone (-5)
          </h3>
          <div class="space-y-2">
            {#each tensionAnswers as ans}
              {@const who = gameState.results?.filter(
                (r) => r.matchedRank === ans.rank
              )}
              <div class="flex items-center gap-4 p-3 rounded-lg bg-red-900/20">
                <div
                  class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center font-bold text-sm"
                >
                  {ans.rank}
                </div>
                <div class="flex-1">
                  <div class="font-medium">{ans.answer}</div>
                  {#if who && who.length}
                    <div class="text-xs text-tension-400 mt-1">
                      {who.map((w) => w.playerName).join(', ')} 💀
                    </div>
                  {/if}
                </div>
                <div class="text-lg font-bold text-tension-400">-5</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Player submissions -->
      <div class="card mb-6">
        <h3 class="text-xl font-semibold mb-4">Player Answers</h3>
        <div class="space-y-2">
          {#each gameState.results as result}
            <div
              class="flex items-center gap-4 p-3 rounded-lg {result.points > 0
                ? 'bg-green-900/30'
                : result.points < 0
                  ? 'bg-red-900/20'
                  : 'bg-gray-700/50'}"
            >
              <div class="flex-1">
                <div class="font-medium">{result.playerName}</div>
                <div class="text-sm text-gray-400">
                  "{result.answer}"
                  {#if result.matchedRank}
                    → #{result.matchedRank}
                  {:else}
                    → not on list
                  {/if}
                  {#if result.usedDouble}🔥{/if}
                  {#if result.matchMethod === 'fuzzy'}
                    <span class="text-xs">(fuzzy)</span>
                  {/if}
                </div>
              </div>
              <div
                class="text-lg font-bold {result.points > 0
                  ? 'text-green-400'
                  : result.points < 0
                    ? 'text-tension-400'
                    : 'text-gray-400'}"
              >
                {result.points > 0 ? '+' : ''}{result.points}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="card mb-6">
        <h3 class="text-xl font-semibold mb-4">Leaderboard</h3>
        <div class="space-y-2">
          {#each gameState.leaderboard || [] as player, i}
            <div
              class="flex items-center gap-4 p-3 rounded-lg {i === 0
                ? 'bg-yellow-900/30'
                : 'bg-gray-700/50'}"
            >
              <div class="w-8 text-center font-bold text-xl">{i + 1}</div>
              <div class="flex-1 font-medium">{player.name}</div>
              <div class="text-xl font-bold">{player.score}</div>
            </div>
          {/each}
        </div>
      </div>

      {#if isHost}
        <div class="text-center">
          <button on:click={nextRound} class="btn-success text-lg px-12 py-4">
            {gameState.currentRound >= (gameState.totalRounds || 0)
              ? 'End Game'
              : 'Next Round'}
          </button>
        </div>
      {:else}
        <p class="text-center text-gray-400 text-sm">
          Waiting for host to continue...
        </p>
      {/if}
    </div>
  {:else if gameState.status === 'completed'}
    <div class="max-w-2xl mx-auto text-center">
      <h2 class="text-4xl font-bold mb-8">Game Over!</h2>

      <div class="card">
        <h3 class="text-2xl font-semibold mb-6">Final Standings</h3>
        <div class="space-y-3">
          {#each gameState.leaderboard || [] as player, i}
            <div
              class="flex items-center gap-4 p-4 rounded-lg {i === 0
                ? 'bg-yellow-500/20 border-2 border-yellow-500'
                : i === 1
                  ? 'bg-gray-400/20 border-2 border-gray-400'
                  : i === 2
                    ? 'bg-orange-600/20 border-2 border-orange-600'
                    : 'bg-gray-700'}"
            >
              <div class="text-3xl font-bold w-12">
                {#if i === 0}🥇{:else if i === 1}🥈{:else if i === 2}🥉{:else}{i +
                    1}{/if}
              </div>
              <div class="flex-1 text-left">
                <div class="text-xl font-bold">{player.name}</div>
              </div>
              <div class="text-3xl font-bold">{player.score}</div>
            </div>
          {/each}
        </div>
      </div>

      <div class="mt-8">
        <a href="/" class="btn-primary inline-block">Play Again</a>
      </div>
    </div>
  {:else if gameState.status === 'waiting' || gameState.status === 'setup'}
    <div class="max-w-md mx-auto text-center">
      <div class="card">
        <h2 class="text-2xl font-bold mb-4">
          {isHost ? 'Waiting Room' : 'Waiting for Host'}
        </h2>
        <p class="text-gray-400 mb-6">
          {#if isHost}
            Go back to the host screen to start, or wait for players.
          {:else}
            The game will start when the host begins. Hang tight!
          {/if}
        </p>
        <div class="text-sm text-gray-500 mb-4">
          Game Code: <span class="font-mono font-bold">{gameCode}</span>
        </div>
        {#if gameState.players.length}
          <div class="space-y-2 text-left">
            {#each gameState.players as p (p.id)}
              <div class="flex justify-between p-2 bg-gray-700 rounded">
                <span>{p.name}</span>
                <span>{p.connected ? '🟢' : '🔴'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
