export class AsyncLock {
  private current: Promise<unknown> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.current;
    let release!: (value?: unknown) => void;
    this.current = new Promise((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const configWriteLock = new AsyncLock();
