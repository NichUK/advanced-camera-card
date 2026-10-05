import { Timer } from '../timer';

/** Bound a caller's wait; late completion must not mutate its current view. */
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
