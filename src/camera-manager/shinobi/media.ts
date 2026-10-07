import { ViewMedia, ViewMediaType, type RecordingViewMedia } from '../../view/item';
import type { RecordingPlaybackOptions } from '../../view/recording-playback';
import { preflightShinobiMedia, resolveShinobiMedia } from './resolve';

const PLAYBACK_OPTIONS: RecordingPlaybackOptions = {
  resolveMedia: resolveShinobiMedia,
  preflight: preflightShinobiMedia,
  continueAdjacentFiles: true,
  loadTimeoutSeconds: 8,
  stallTimeoutSeconds: 8,
  continuationWindowSeconds: 26 * 3600,
};

export class ShinobiRecording extends ViewMedia implements RecordingViewMedia {
  private readonly _downloadEnabled: boolean;
  private readonly _contentID: string;
  private readonly _id: string;
  private readonly _start: Date;
  private readonly _end: Date;
  public override requiresExactTimeSelection(): boolean {
    return true;
  }
  public override getRecordingPlaybackOptions(): RecordingPlaybackOptions {
    return PLAYBACK_OPTIONS;
  }
  constructor(
    cameraID: string,
    contentID: string,
    id: string,
    start: Date,
    end: Date,
    downloadEnabled = false,
  ) {
    super(ViewMediaType.Recording, { cameraID });
    this._downloadEnabled = downloadEnabled;
    this._contentID = contentID;
    this._id = id;
    this._start = start;
    this._end = end;
  }

  public isDownloadEnabled(): boolean {
    return this._downloadEnabled;
  }

  public override getID(): string {
    return this._id;
  }
  public override getContentID(): string {
    return this._contentID;
  }
  public override getStartTime(): Date {
    return this._start;
  }
  public override getEndTime(): Date {
    return this._end;
  }
  public override getTitle(): string {
    return this._start.toISOString();
  }
  public override inProgress(): boolean {
    return false;
  }
  public getEventCount(): null {
    return null;
  }
  public override includesTime(instant: Date): boolean {
    return instant >= this._start && instant < this._end;
  }
}
