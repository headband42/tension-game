/** A reactive "now" that ticks while the component that created it is mounted. */
export class Ticker {
  now = $state(Date.now());

  constructor(intervalMs = 250) {
    $effect(() => {
      const id = setInterval(() => (this.now = Date.now()), intervalMs);
      return () => clearInterval(id);
    });
  }
}
