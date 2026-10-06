// @vitest-environment jsdom
import { assert, expect, it, vi } from 'vitest';

import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import { RecordingContinuation } from '../../../src/components-lib/viewer/recording-continuation';
import { TestViewMedia } from '../../view/test-utils';

const clip = (start: number, end: number, cameraID = 'camera') =>
  new ShinobiRecording(
    cameraID,
    'clip-' + start,
    'clip-' + start,
    new Date(start),
    new Date(end),
  );

it('advances once at a contiguous boundary and keeps an overlap at the same instant', async () => {
  const changed = vi.fn();
  const continuation = new RecordingContinuation(changed);
  const source = clip(0, 1000);
  const advance = vi.fn().mockResolvedValue(undefined);
  const load = vi.fn();
  await continuation.ended(source, [source, clip(1000, 2000)], {
    now: new Date(3000),
    load,
    advance,
  });
  await continuation.ended(source, [], { now: new Date(3000), load, advance });
  expect(advance).toHaveBeenCalledExactlyOnceWith(new Date(1000), expect.any(Function));
  expect(load).not.toHaveBeenCalled();
  expect(continuation.getState()).toBeNull();
  expect(advance.mock.calls[0][1]()).toBe(true);
  continuation.cancel();
  expect(advance.mock.calls[0][1]()).toBe(false);
  await continuation.ended(source, [clip(500, 2000)], {
    now: new Date(3000),
    load,
    advance,
  });
  expect(advance).toHaveBeenLastCalledWith(new Date(1000), expect.any(Function));
});

it('stops at a real gap and filters other cameras and legacy media', async () => {
  const continuation = new RecordingContinuation(vi.fn());
  const advance = vi.fn();
  const load = vi.fn();
  await continuation.ended(
    clip(0, 1000),
    [clip(1000, 2000, 'other'), new TestViewMedia(), clip(36000, 37000)],
    { now: new Date(60000), load, advance },
  );
  expect(continuation.getState()).toEqual({ state: 'gap', next: new Date(36000) });
  expect(advance).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

it('loads bounded adjacent metadata and verifies the end of available history', async () => {
  const continuation = new RecordingContinuation(vi.fn());
  const advance = vi.fn().mockResolvedValue(undefined);
  const load = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([clip(26 * 3600000, 27 * 3600000)]);
  await continuation.ended(clip(0, 1000), [], {
    now: new Date(27 * 3600000),
    load,
    advance,
  });
  expect(load.mock.calls[0]).toEqual([new Date(1000), new Date(26 * 3600000 + 1000)]);
  expect(continuation.getState()?.state).toBe('gap');
  continuation.cancel();
  load.mockResolvedValue([]);
  await continuation.ended(clip(0, 1000), [], { now: new Date(2000), load, advance });
  expect(continuation.getState()).toEqual({ state: 'end' });
  expect(advance).not.toHaveBeenCalled();
});

it.each(['load', 'advance'])(
  'cancels an abandoned %s without a late state update',
  async (stage) => {
    const changed = vi.fn();
    const continuation = new RecordingContinuation(changed);
    let finish: (() => void) | undefined;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const advance = vi.fn(async () => {
      if (stage === 'advance') {
        await work;
      }
    });
    const load = vi.fn(async () => {
      await work;
      return [clip(1000, 2000)];
    });
    const pending = continuation.ended(
      clip(0, 1000),
      stage === 'advance' ? [clip(1000, 2000)] : [],
      { now: new Date(3000), load, advance },
    );
    expect(continuation.getState()).toEqual({ state: 'loading' });
    continuation.cancel();
    changed.mockClear();
    assert(finish);
    finish();
    await pending;
    expect(continuation.getState()).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledTimes(stage === 'advance' ? 1 : 0);
  },
);

it('rejects unknown or failed metadata and expires stalled work without accepting its late result', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const continuation = new RecordingContinuation(vi.fn());
  const advance = vi.fn();
  await continuation.ended(clip(0, 1000), [], {
    now: new Date(2000),
    load: async () => null,
    advance,
  });
  expect(continuation.getState()).toEqual({ state: 'error' });
  continuation.cancel();
  vi.useFakeTimers();
  try {
    let finish: ((media: ShinobiRecording[]) => void) | undefined;
    const pending = continuation.ended(clip(0, 1000), [], {
      now: new Date(2000),
      load: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      advance,
    });
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(continuation.getState()).toEqual({ state: 'error' });
    assert(finish);
    finish([clip(1000, 2000)]);
    await Promise.resolve();
    expect(advance).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    warn.mockRestore();
  }
});

it('leaves legacy and incomplete identities alone', async () => {
  const continuation = new RecordingContinuation(vi.fn());
  const options = { now: new Date(0), load: vi.fn(), advance: vi.fn() };
  await continuation.ended(new TestViewMedia(), [], options);
  const missingEnd = new TestViewMedia({ cameraID: 'camera' });
  vi.spyOn(missingEnd, 'requiresExactTimeSelection').mockReturnValue(true);
  await continuation.ended(missingEnd, [], options);
  const incomplete = new TestViewMedia({ endTime: new Date(0), cameraID: null });
  vi.spyOn(incomplete, 'requiresExactTimeSelection').mockReturnValue(true);
  await continuation.ended(incomplete, [], options);
  expect(continuation.getState()).toBeNull();
});

it.each(['discovery', 'advance'])(
  'logs a redacted %s failure category without retaining an upstream secret',
  async (stage) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const continuation = new RecordingContinuation(vi.fn());
      await continuation.ended(
        clip(0, 1000),
        stage === 'advance' ? [clip(1000, 2000)] : [],
        {
          now: new Date(5000),
          load: async () => {
            throw new Error('SECRET upstream URL');
          },
          advance: async () => {
            throw new Error('SECRET upstream URL');
          },
        },
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Recording continuation failed' }),
        { stage, reason: 'request_failed' },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
    }
  },
);

it('categorizes a timed-out explicit continuation', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.useFakeTimers();
  try {
    const continuation = new RecordingContinuation(vi.fn());
    await continuation.ended(clip(0, 1000), [clip(3000, 4000)], {
      now: new Date(5000),
      load: vi.fn(),
      advance: vi.fn(),
    });
    const work = continuation.continueNext(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(10000);
    await work;
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Recording continuation failed' }),
      { stage: 'advance', reason: 'timeout' },
    );
    expect(continuation.getState()).toEqual({ state: 'error' });
  } finally {
    vi.useRealTimers();
    warn.mockRestore();
  }
});

it('loads an adjacent file and exposes explicit continuation only at a confirmed gap', async () => {
  const continuation = new RecordingContinuation(vi.fn());
  const advance = vi.fn().mockResolvedValue(undefined);
  await continuation.continueNext(advance);
  expect(advance).not.toHaveBeenCalled();
  await continuation.ended(clip(0, 1000), [], {
    now: new Date(2000),
    load: async () => [clip(1000, 2000)],
    advance,
  });
  expect(advance).toHaveBeenCalledExactlyOnceWith(new Date(1000), expect.any(Function));
  continuation.cancel();
  const unknownStart = new TestViewMedia({ startTime: null, endTime: new Date(2000) });
  vi.spyOn(unknownStart, 'requiresExactTimeSelection').mockReturnValue(true);
  await continuation.ended(
    clip(0, 1000),
    [unknownStart, clip(3000, 4000), clip(2500, 2600)],
    { now: new Date(5000), load: vi.fn(), advance },
  );
  await continuation.continueNext(advance);
  expect(advance).toHaveBeenLastCalledWith(new Date(2500), expect.any(Function));
  expect(advance.mock.calls[1][1]()).toBe(true);
  expect(continuation.getState()).toBeNull();
});

it.each([false, true])(
  'ignores canceled failures and presents current explicit-continuation failures (cancel=%s)',
  async (canceled) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const continuation = new RecordingContinuation(vi.fn());
    const advance = vi.fn();
    await continuation.ended(clip(0, 1000), [clip(3000, 4000)], {
      now: new Date(5000),
      load: vi.fn(),
      advance,
    });
    let fail: ((error: Error) => void) | undefined;
    const pending = continuation.continueNext(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    if (canceled) {
      continuation.cancel();
    }
    assert(fail);
    fail(new Error('Failed'));
    await pending;
    expect(continuation.getState()).toEqual(canceled ? null : { state: 'error' });
    warn.mockRestore();
  },
);

it('ignores a canceled explicit success and canceled automatic failure', async () => {
  const continuation = new RecordingContinuation(vi.fn());
  await continuation.ended(clip(0, 1000), [clip(3000, 4000)], {
    now: new Date(5000),
    load: vi.fn(),
    advance: vi.fn(),
  });
  let finish: (() => void) | undefined;
  const pending = continuation.continueNext(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  continuation.cancel();
  assert(finish);
  finish();
  await pending;
  expect(continuation.getState()).toBeNull();
  let fail: ((error: Error) => void) | undefined;
  const automatic = continuation.ended(clip(0, 1000), [], {
    now: new Date(5000),
    load: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    advance: vi.fn(),
  });
  continuation.cancel();
  assert(fail);
  fail(new Error('Old failed request'));
  await automatic;
  expect(continuation.getState()).toBeNull();
});

it('honors an immediate pause when loading becomes visible before issuing metadata work', async () => {
  const continuation = new RecordingContinuation(() => {
    if (continuation.getState()?.state === 'loading') {
      continuation.cancel();
    }
  });
  const load = vi.fn();
  const advance = vi.fn();
  await continuation.ended(clip(0, 1000), [], { now: new Date(2000), load, advance });
  expect(continuation.getState()).toBeNull();
  expect(load).not.toHaveBeenCalled();
  expect(advance).not.toHaveBeenCalled();
});
