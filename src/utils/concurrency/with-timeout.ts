import { Timer } from '../timer';

/** Bound the wait, without cancelling work; callers own abort/stale-result guards. */
export const withTimeout = async <T>(
  work: Promise<T>,
  milliseconds: number,
  error: Error,
): Promise<T> => {
  const timer = new Timer();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer.start(milliseconds / 1000, () => reject(error));
      }),
    ]);
  } finally {
    timer.stop();
  }
};
