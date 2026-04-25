/**
 * Bounded-concurrency primitive. Acquire a slot, do work, release.
 * Provider-specific instances let Anthropic and OpenAI workers throttle
 * independently of each other, which matters because their rate-limit
 * ceilings are very different.
 */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(public readonly capacity: number) {
    if (capacity < 1) throw new Error(`Semaphore capacity must be >= 1, got ${capacity}`);
    this.available = capacity;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}
