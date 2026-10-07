import {
  html,
  LitElement,
  nothing,
  unsafeCSS,
  type CSSResultGroup,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import { MediaLoadedInfoSourceController } from '../components-lib/media-loaded-info-source-controller.js';
import { FRAME_STALL_SECONDS } from '../components-lib/media-player/frame-stall-watchdog';
import { VideoMediaPlayerController } from '../components-lib/media-player/video';
import { triggerMediaUnavailableIssue } from '../components-lib/media-unavailable-issue.js';
import videoPlayerStyle from '../scss/video-player.scss?inline';
import type { MediaPlayer, MediaPlayerController, MediaPlayerElement } from '../types';
import { mayHaveAudio } from '../utils/audio';
import { withTimeout } from '../utils/concurrency/with-timeout';
import {
  hideMediaControlsTemporarily,
  MEDIA_LOAD_CONTROLS_HIDE_SECONDS,
} from '../utils/controls';
import { fireAdvancedCameraCardEvent } from '../utils/fire-advanced-camera-card-event';
import {
  createMediaLoadedInfo,
  dispatchMediaPauseEvent,
  dispatchMediaPlayEvent,
  dispatchMediaVolumeChangeEvent,
} from '../utils/media-info';
import type { RecordingPlaybackOptions } from '../view/recording-playback';
import {
  RecordingPlaybackError,
  recordingPlaybackError,
} from '../view/recording-playback.js';

@customElement('advanced-camera-card-video-player')
export class AdvancedCameraCardVideoPlayer extends LitElement implements MediaPlayer {
  @property()
  public url?: string;

  @property()
  public targetID?: string;

  @property({ type: Boolean })
  public controls = false;

  @property({ type: Boolean })
  public archive = false;

  @property({ attribute: false })
  public playbackOptions?: RecordingPlaybackOptions;

  private _recordingPlaybackError(): void {
    if (!this.archive || !this.targetID) {
      return;
    }
    this._reportArchiveError(this._nativeRecordingPlaybackError());
  }

  private _nativeRecordingPlaybackError(): RecordingPlaybackError {
    const code = this._refVideo.value?.error?.code;
    return new RecordingPlaybackError(
      code === 3 ? 'decode' : code === 2 ? 'network' : 'unsupported',
      'playback',
    );
  }

  private _reportArchiveError(error: RecordingPlaybackError): void {
    if (!this.targetID) {
      return;
    }
    triggerMediaUnavailableIssue(this, {
      targetID: this.targetID,
      reason: error.category === 'network' ? 'server_error' : 'unsupported',
      description: error.message,
      automaticRetry: error.retryable,
    });
  }

  private async _archiveSourceError(): Promise<void> {
    if (!this.archive || !this.url || !this.targetID) {
      return;
    }
    const url = this.url;
    const targetID = this.targetID;
    const preflight = this.playbackOptions?.preflight;
    if (!preflight) {
      this._reportArchiveError(new RecordingPlaybackError('unsupported', 'playback'));
      return;
    }
    const abort = new AbortController();
    let error: RecordingPlaybackError | null = null;
    try {
      await withTimeout(
        preflight(url, abort, 'playback'),
        10000,
        new RecordingPlaybackError('timeout', 'playback'),
      );
      // Healthy transport does not change the browser's decode/network diagnosis.
      error = this._nativeRecordingPlaybackError();
    } catch (failure) {
      error = recordingPlaybackError(failure, 'playback');
    } finally {
      abort.abort();
    }
    if (error && this.isConnected && this.url === url && this.targetID === targetID) {
      this._reportArchiveError(error);
    }
  }

  private _refVideo: Ref<MediaPlayerElement<HTMLVideoElement>> = createRef();
  private _mediaPlayerController = new VideoMediaPlayerController(
    this,
    () => this._refVideo.value ?? null,
    () => this.controls,
    () => this.playbackOptions?.stallTimeoutSeconds ?? FRAME_STALL_SECONDS,
  );

  private _mediaLoadedInfoSourceController = new MediaLoadedInfoSourceController(this, {
    getTargetID: () => this.targetID ?? null,
  });

  public async getMediaPlayerController(): Promise<MediaPlayerController | null> {
    return this._mediaPlayerController;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  public disconnectedCallback(): void {
    // Lit clears ref directives when super disconnects the render tree.
    const video = this._refVideo.value;
    if (this.archive) {
      this._mediaLoadedInfoSourceController.clear();
    }
    super.disconnectedCallback();
    if (this.archive && video) {
      video.pause();
      video.removeAttribute('src');
      video.querySelector('source')?.removeAttribute('src');
      video.load();
    }
  }

  protected render(): TemplateResult | void {
    return html`
      <video
        ${ref(this._refVideo)}
        muted
        playsinline
        crossorigin="anonymous"
        ?autoplay=${false}
        ?controls=${this.controls}
        @loadedmetadata=${(ev: Event) => {
          if (ev.target && this.controls) {
            hideMediaControlsTemporarily(
              ev.target as HTMLVideoElement,
              MEDIA_LOAD_CONTROLS_HIDE_SECONDS,
            );
          }
        }}
        @loadeddata="${(ev: Event) => {
          if (
            this.archive &&
            ev.target instanceof HTMLVideoElement &&
            (!ev.target.videoWidth || !ev.target.videoHeight)
          ) {
            // A supported audio track can hide an unsupported video codec:
            // native playback advances without an error or a visible frame.
            ev.target.pause();
            this._recordingPlaybackError();
            return;
          }
          const info = createMediaLoadedInfo(ev, {
            ...(this._mediaPlayerController && {
              mediaPlayerController: this._mediaPlayerController,
            }),
            capabilities: {
              supportsPause: true,
              hasAudio: mayHaveAudio(ev.target as HTMLVideoElement),
            },
            technology: ['mp4'],
          });
          if (info) {
            this._mediaLoadedInfoSourceController.set(info);
          }
        }}"
        @volumechange=${() => dispatchMediaVolumeChangeEvent(this)}
        @play=${() => dispatchMediaPlayEvent(this)}
        @pause=${(event: Event) => {
          if (event.target instanceof HTMLVideoElement && !event.target.ended) {
            fireAdvancedCameraCardEvent(this, 'media:pause-request');
          }
          dispatchMediaPauseEvent(this);
        }}
        @ended=${() => fireAdvancedCameraCardEvent(this, 'media:ended')}
        @timeupdate=${() => {
          if (this.archive) {
            fireAdvancedCameraCardEvent(this, 'media:time-update', {
              mediaID: this.targetID ?? null,
              seconds: this._refVideo.value?.currentTime ?? Number.NaN,
            });
          }
        }}
        @seeking=${() => fireAdvancedCameraCardEvent(this, 'media:seek-request')}
        @error=${() => this._recordingPlaybackError()}
      >
        <source
          src=${live(this.url ?? nothing)}
          type="video/mp4"
          @error=${() => void this._archiveSourceError()}
        />
      </video>
    `;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(videoPlayerStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-video-player': AdvancedCameraCardVideoPlayer;
  }
}
