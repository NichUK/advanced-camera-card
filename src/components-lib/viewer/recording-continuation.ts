import { errorToConsole } from '../../utils/basic';
import { withTimeout } from '../../utils/concurrency/with-timeout';
import { findBestMediaTimeIndex } from '../../utils/find-best-media-time-index';
import type { ViewMedia } from '../../view/item';

export type RecordingContinuationState =
  | { state: 'loading' }
  | { state: 'gap'; next: Date }
  | { state: 'end' }
  | { state: 'error' };

/** Original-file continuation: a gap always requires an explicit operator action. */
export class RecordingContinuation {
  private _epoch = 0;
  private _source: ViewMedia | null = null;
  private _state: RecordingContinuationState | null = null;
  private _changed: () => void;

  constructor(changed: () => void) {
    this._changed = changed;
  }

  public getState(): RecordingContinuationState | null {
    return this._state;
  }

  public cancel(): void {
    this._epoch++;
    this._source = null;
    this._state = null;
    this._changed();
  }

  public async continueNext(
    advance: (time: Date, current: () => boolean) => Promise<void>,
  ): Promise<void> {
    if (this._state?.state !== 'gap') {
      return;
    }
    const next = this._state.next;
    const epoch = ++this._epoch;
    this._state = { state: 'loading' };
    this._changed();
    try {
      await withTimeout(
        advance(next, () => epoch === this._epoch),
        10000,
        new Error('Recording continuation timeout'),
      );
      if (epoch === this._epoch) {
        this._state = null;
        this._changed();
      }
    } catch {
      if (epoch === this._epoch) {
        this._epoch++;
        errorToConsole(new Error('Recording continuation failed'));
        this._state = { state: 'error' };
        this._changed();
      }
    }
  }

  public async ended(
    source: ViewMedia,
    known: readonly ViewMedia[],
    options: {
      now: Date;
      load: (start: Date, end: Date) => Promise<ViewMedia[] | null>;
      advance: (time: Date, current: () => boolean) => Promise<void>;
    },
  ): Promise<void> {
    const boundary = source.getEndTime();
    const camera = source.getCameraID();
    if (
      !source.requiresExactTimeSelection() ||
      !boundary ||
      !camera ||
      this._source === source
    ) {
      return;
    }
    this._source = source;
    const epoch = ++this._epoch;
    this._state = { state: 'loading' };
    this._changed();
    const current = (): boolean => epoch === this._epoch;
    const decide = (media: readonly ViewMedia[]): boolean => {
      const candidates = media.filter(
        (item) =>
          item !== source &&
          item.getCameraID() === camera &&
          item.requiresExactTimeSelection(),
      );
      const index = findBestMediaTimeIndex(candidates, boundary, camera);
      if (index !== null) {
        return true;
      }
      const next = candidates
        .map((item) => item.getStartTime())
        .filter((time): time is Date => !!time && time > boundary)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (next) {
        this._state = { state: 'gap', next };
      }
      return false;
    };
    try {
      const work = async (): Promise<void> => {
        if (!current()) {
          return;
        }
        let covered = decide(known);
        let start = boundary;
        while (!covered && this._state?.state !== 'gap' && start < options.now) {
          const end = new Date(
            Math.min(start.getTime() + 26 * 3600000, options.now.getTime()),
          );
          const media = await options.load(start, end);
          if (!current()) {
            return;
          }
          if (media === null) {
            throw new Error('Recording metadata unavailable');
          }
          covered = decide(media);
          start = end;
        }
        if (covered) {
          await options.advance(boundary, current);
          if (!current()) {
            return;
          }
          this._state = null;
        } else if (this._state?.state !== 'gap') {
          this._state = { state: 'end' };
        }
      };
      await withTimeout(work(), 10000, new Error('Recording continuation timeout'));
      if (current()) {
        this._changed();
      }
    } catch {
      if (current()) {
        errorToConsole(new Error('Recording continuation failed'));
        // Invalidate remaining work, including a load that outlives its deadline.
        this._epoch++;
        this._state = { state: 'error' };
        this._changed();
      }
    }
  }
}
