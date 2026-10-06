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

import { ShinobiArchiveError } from '../camera-manager/shinobi/errors.js';
import { preflightShinobiMedia } from '../camera-manager/shinobi/resolve.js';
import { MediaLoadedInfoSourceController } from '../components-lib/media-loaded-info-source-controller.js';
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

  private _archiveError(): void {
    if (!this.archive || !this.targetID) {
      return;
    }
    const code = this._refVideo.value?.error?.code;
    const error = new ShinobiArchiveError(
      code === 3 ? 'decode' : code === 2 ? 'network' : 'unsupported',
      'playback',
    );
    this._reportArchiveError(error);
  }

  private _reportArchiveError(error: ShinobiArchiveError): void {
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
    const abort = new AbortController();
    let error = new ShinobiArchiveError('unsupported', 'playback');
    try {
      await withTimeout(
        preflightShinobiMedia(url, abort, 'playback'),
        10000,
        new ShinobiArchiveError('timeout', 'playback'),
      );
    } catch (failure) {
      if (failure instanceof ShinobiArchiveError) {
        error = failure;
      }
    } finally {
      abort.abort();
    }
    if (this.isConnected && this.url === url && this.targetID === targetID) {
      this._reportArchiveError(error);
    }
  }

  private _refVideo: Ref<MediaPlayerElement<HTMLVideoElement>> = createRef();
  private _mediaPlayerController = new VideoMediaPlayerController(
    this,
    () => this._refVideo.value ?? null,
    () => this.controls,
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
            this._archiveError();
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
        @seeking=${() => fireAdvancedCameraCardEvent(this, 'media:seek-request')}
        @error=${() => this._archiveError()}
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
