// @vitest-environment jsdom
import { assert, expect, it, vi } from 'vitest';

import { withTimeout } from '../../../src/utils/concurrency/with-timeout';

it('bounds stalled work and clears deadlines after success or failure', async () => {
  vi.useFakeTimers();
  try {
    expect(
      await withTimeout(Promise.resolve('ready'), 10000, new Error('Expired')),
    ).toBe('ready');
    await expect(
      withTimeout(Promise.reject(new Error('Failed')), 10000, new Error('Expired')),
    ).rejects.toThrow('Failed');
    let finish: ((value: string) => void) | undefined;
    const work = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const expired = withTimeout(work, 10000, new Error('Expired'));
    const assertion = expect(expired).rejects.toThrow('Expired');
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    assert(finish);
    finish('late');
    expect(await work).toBe('late');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
