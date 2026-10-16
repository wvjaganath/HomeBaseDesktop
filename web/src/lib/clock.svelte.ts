/** A shared clock that ticks on the minute (and every second only if asked). */
class Clock {
  now = $state(new Date());
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.timer) return;
    const tick = (): void => {
      this.now = new Date();
      // Align to the next whole second; cheap and keeps the minute flip exact.
      this.timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
  }
}

export const clock = new Clock();
