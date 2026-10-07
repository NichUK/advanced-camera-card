import type { HomeAssistant, ResolvedMedia } from '../ha/types';
import { localize } from '../localize/localize';
import { AdvancedCameraCardError } from '../types';

export type RecordingFailure =
  | 'authentication'
  | 'denied'
  | 'unavailable'
  | 'network'
  | 'metadata'
  | 'timeout'
  | 'unsupported'
  | 'decode';
export type RecordingFailureStage =
  | 'discovery'
  | 'resolve'
  | 'playback'
  | 'continuation';

/** A backend supplies transport; the shared viewer owns presentation/lifecycle. */
export interface RecordingPlaybackOptions {
  resolveMedia: (hass: HomeAssistant, contentID: string) => Promise<ResolvedMedia>;
  preflight: (
    url: string,
    abort: AbortController,
    stage: 'resolve' | 'playback',
  ) => Promise<void>;
  continueAdjacentFiles: boolean;
  loadTimeoutSeconds: number;
  stallTimeoutSeconds: number;
  continuationWindowSeconds: number;
}

export class RecordingPlaybackError extends AdvancedCameraCardError {
  public readonly category: RecordingFailure;
  public readonly retryable: boolean;

  constructor(category: RecordingFailure, stage: RecordingFailureStage) {
    super(localize(`recordings.errors.${category}`), { category, stage });
    this.category = category;
    this.retryable = category === 'network' || category === 'timeout';
  }
}

export const recordingPlaybackError = (
  error: unknown,
  stage: RecordingFailureStage,
): RecordingPlaybackError =>
  error instanceof RecordingPlaybackError
    ? error
    : new RecordingPlaybackError('metadata', stage);
