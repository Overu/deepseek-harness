export const PUBLIC_UPLOAD_CONCURRENCY = 5;

export type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new Error('maxConcurrent must be a positive integer');
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    while (activeCount < maxConcurrent) {
      const startTask = queue.shift();
      if (!startTask) return;
      activeCount += 1;
      startTask();
    }
  };

  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void Promise.resolve()
          .then(task)
          .then(
            value => {
              activeCount -= 1;
              runNext();
              resolve(value);
            },
            error => {
              activeCount -= 1;
              runNext();
              reject(error);
            }
          );
      });
      runNext();
    });
}
