import { AdvancedCameraCardError } from '../../types';
import { errorToConsole } from '../../utils/basic';
import { withTimeout } from '../../utils/concurrency/with-timeout';
import { findBestMediaTimeIndex } from '../../utils/find-best-media-time-index';
import type { ViewMedia } from '../../view/item';
import {
  recordingPlaybackError,
  RecordingPlaybackError,
} from '../../view/recording-playback';

const CONTINUATION_TIMEOUT_MS = 10000;

export type RecordingContinuationState =
  | { state: 'loading' }
  | { state: 'gap'; next: Date }
  | { state: 'end' }
  | { state: 'error'; time: Date; error: RecordingPlaybackError };

/** Original-file continuation: a gap always requires an explicit operator action. */
export class RecordingContinuation {
  private _epoch = 0;
  private _source: ViewMedia | null = null;
  private _state: RecordingContinuationState | null = null;
  private _changed: () => void;
  private _retryDiscovery: (() => Promise<void>) | null = null;

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
    this._retryDiscovery = null;
    this._changed();
  }

  public async continueNext(
    advance: (time: Date, current: () => boolean) => Promise<void>,
  ): Promise<void> {
    if (this._state?.state === 'error' && this._retryDiscovery) {
      await this._retryDiscovery();
      return;
    }
    if (this._state?.state !== 'gap' && this._state?.state !== 'error') {
      return;
    }
    const next = this._state.state === 'gap' ? this._state.next : this._state.time;
    const epoch = ++this._epoch;
    this._state = { state: 'loading' };
    this._changed();
    const timeoutError = new RecordingPlaybackError('timeout', 'continuation');
    try {
      await withTimeout(
        advance(next, () => epoch === this._epoch),
        CONTINUATION_TIMEOUT_MS,
        timeoutError,
      );
      if (epoch === this._epoch) {
        this._state = null;
        this._changed();
      }
    } catch (error) {
      if (epoch === this._epoch) {
        this._epoch++;
        const failure = recordingPlaybackError(error, 'continuation');
        errorToConsole(
          new AdvancedCameraCardError('Recording continuation failed', {
            stage: 'advance',
            reason: error === timeoutError ? 'timeout' : 'request_failed',
            category: failure.category,
          }),
        );
        this._state = { state: 'error', time: next, error: failure };
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
    const playback = source.getRecordingPlaybackOptions();
    if (
      !playback?.continueAdjacentFiles ||
      !Number.isFinite(playback.continuationWindowSeconds) ||
      playback.continuationWindowSeconds <= 0 ||
      !boundary ||
      !camera ||
      this._source === source
    ) {
      return;
    }
    this._source = source;
    this._retryDiscovery = null;
    const epoch = ++this._epoch;
    this._state = { state: 'loading' };
    this._changed();
    const current = (): boolean => epoch === this._epoch;
    const decide = (media: readonly ViewMedia[]): boolean => {
      const candidates = media.filter(
        (item) =>
          item !== source &&
          item.getCameraID() === camera &&
          item.getRecordingPlaybackOptions()?.continueAdjacentFiles,
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
    const timeoutError = new RecordingPlaybackError('timeout', 'continuation');
    let stage = 'discovery';
    try {
      const work = async (): Promise<void> => {
        if (!current()) {
          return;
        }
        let covered = decide(known);
        let start = boundary;
        while (!covered && this._state?.state !== 'gap' && start < options.now) {
          const end = new Date(
            Math.min(
              start.getTime() + playback.continuationWindowSeconds * 1000,
              options.now.getTime(),
            ),
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
          stage = 'advance';
          await options.advance(boundary, current);
          if (!current()) {
            return;
          }
          this._state = null;
        } else if (this._state?.state !== 'gap') {
          this._state = { state: 'end' };
        }
      };
      await withTimeout(work(), CONTINUATION_TIMEOUT_MS, timeoutError);
      if (current()) {
        this._changed();
      }
    } catch (error) {
      if (current()) {
        const failure = recordingPlaybackError(error, 'continuation');
        errorToConsole(
          new AdvancedCameraCardError('Recording continuation failed', {
            stage,
            reason: error === timeoutError ? 'timeout' : 'request_failed',
            category: failure.category,
          }),
        );
        // Invalidate remaining work, including a load that outlives its deadline.
        this._epoch++;
        if (stage === 'discovery') {
          this._retryDiscovery = async () => {
            this._source = null;
            await this.ended(source, known, options);
          };
        }
        this._state = { state: 'error', time: boundary, error: failure };
        this._changed();
      }
    }
  }
}
