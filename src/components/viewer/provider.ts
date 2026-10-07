import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { guard } from 'lit/directives/guard.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import type { CameraManager } from '../../camera-manager/manager.js';
import { QueryType } from '../../camera-manager/types.js';
import type { IssueTriggerEventData } from '../../card-controller/issues/types.js';
import type { ViewManagerEpoch } from '../../card-controller/view/types.js';
import { LazyLoadController } from '../../components-lib/lazy-load-controller.js';
import { MediaPlayerLivenessDetector } from '../../components-lib/live/liveness/detectors/media-player-liveness.js';
import {
  MEDIA_LOADING_TIMEOUT_SECONDS,
  MediaLoadWatchdogController,
} from '../../components-lib/media-load-watchdog-controller.js';
import {
  resolveMediaUnavailableIssue,
  triggerMediaUnavailableIssue,
} from '../../components-lib/media-unavailable-issue.js';
import { ResolvedMediaController } from '../../components-lib/resolved-media-controller.js';
import {
  getSignedURLErrorText,
  SignedURLController,
} from '../../components-lib/signed-url-controller.js';
import type { ZoomSettingsObserved } from '../../components-lib/zoom/types.js';
import { handleZoomSettingsObservedEvent } from '../../components-lib/zoom/zoom-view-context.js';
import type { CameraConfig } from '../../config/schema/cameras.js';
import type { CardWideConfig } from '../../config/schema/types.js';
import type { ViewerConfig } from '../../config/schema/viewer.js';
import { canonicalizeHAURL } from '../../ha/canonical-url.js';
import { isHARelativeURL } from '../../ha/is-ha-relative-url.js';
import type { ResolvedMediaCache } from '../../ha/resolved-media.js';
import type { HomeAssistant } from '../../ha/types.js';
import { RecordingPlaybackError } from '../../view/recording-playback.js';

import '../../patches/ha-hls-player.js';

import viewerProviderStyle from '../../scss/viewer-provider.scss?inline';
import type {
  MediaPlayer,
  MediaPlayerController,
  MediaPlayerElement,
} from '../../types.js';
import { classifyMimeType } from '../../utils/mime-type.js';
import { ViewItemClassifier } from '../../view/item-classifier.js';
import type { ViewMedia } from '../../view/item.js';
import { UnifiedQueryTransformer } from '../../view/unified-query-transformer.js';

import '../image-player.js';

import { renderNotificationBlockFromText } from '../notification/block.js';
import { renderProgressIndicator } from '../progress-indicator.js';

import '../video-player.js';
import './../media-dimensions-container';

@customElement('advanced-camera-card-viewer-provider')
export class AdvancedCameraCardViewerProvider extends LitElement implements MediaPlayer {
  @property({ attribute: false })
  public hass?: HomeAssistant;

  @property({ attribute: false })
  public viewManagerEpoch?: ViewManagerEpoch;

  @property({ attribute: false })
  public media?: ViewMedia;

  @property({ attribute: false })
  public viewerConfig?: ViewerConfig;

  @property({ attribute: false })
  public resolvedMediaCache?: ResolvedMediaCache;

  @property({ attribute: false })
  public cameraManager?: CameraManager;

  @property({ attribute: false })
  public cardWideConfig?: CardWideConfig;

  // Whether to force this slide to behave as if it is selected and
  // intersecting. Set by the carousel on its currently-selected slide. This is
  // necessary: `render` below draws nothing until the slide has loaded, and a
  // slide drawing nothing can have no height for IntersectionObserver to see.
  // Left to the observer only, the slide would wait to be seen before drawing
  // anything there was to see. See `LazyLoadConfiguration.forceSelected`.
  @property({ attribute: false })
  public forceSelected = false;

  private _refProvider: Ref<MediaPlayerElement> = createRef();
  private _lazyLoadController: LazyLoadController = new LazyLoadController(this);
  private _archiveLiveness: MediaPlayerLivenessDetector | null = null;
  private _archiveLivenessContentID: string | null = null;
  private _archiveFailure: { contentID: string; description: string } | null = null;

  private _getArchiveFailure(): string | null {
    return this._archiveFailure?.contentID === this.media?.getContentID()
      ? this._archiveFailure?.description ?? null
      : null;
  }

  private _handleArchiveIssue(event: CustomEvent<IssueTriggerEventData>): void {
    const context = event.detail;
    const contentID = this.media?.getContentID();
    if (
      this.media?.getRecordingPlaybackOptions() &&
      contentID &&
      context.key === 'media_unavailable' &&
      context.targetID === this.media.getID() &&
      (context.reason === 'unsupported' || context.reason === 'server_error') &&
      context.description
    ) {
      this._archiveFailure = { contentID, description: context.description };
      this.requestUpdate();
    }
  }

  public disconnectedCallback(): void {
    this._archiveLiveness?.unsubscribe();
    this._archiveLiveness = null;
    super.disconnectedCallback();
  }

  // Lit runs controllers in declaration order: Resolve first, then sign.
  private _resolvedMediaController = new ResolvedMediaController(this, () => ({
    hass: this.hass,
    contentID: this._shouldLoad() ? this.media?.getContentID() ?? null : null,
    cache: this.resolvedMediaCache,
    ...(this.media?.getRecordingPlaybackOptions() && {
      resolve: this.media?.getRecordingPlaybackOptions()?.resolveMedia,
      onError: (error: unknown) => {
        const targetID = this.media?.getID();
        if (targetID && error instanceof RecordingPlaybackError) {
          triggerMediaUnavailableIssue(this, {
            targetID,
            reason: 'server_error',
            description: error.message,
            automaticRetry: error.retryable,
          });
        }
      },
    }),
  }));

  private _signedURLController = new SignedURLController(this, () => {
    const resolvedMedia = this._resolvedMediaController.getValue();
    if (!this.hass || !resolvedMedia) {
      return {};
    }
    // HA-relative URLs need no proxying or signing.
    if (isHARelativeURL(resolvedMedia.url)) {
      return {
        endpoint: { endpoint: canonicalizeHAURL(this.hass, resolvedMedia.url) },
      };
    }
    const cameraID = this.media?.getCameraID();
    const camera = cameraID ? this.cameraManager?.getStore().getCamera(cameraID) : null;
    return {
      hass: this.hass,
      endpoint: { endpoint: resolvedMedia.url },
      proxyConfig: camera?.getMediaProxyConfig(),
    };
  });

  constructor() {
    super();

    // Watch for media load failure (including resolving media ID and signing).
    new MediaLoadWatchdogController(this, {
      getTargetID: () => this.media?.getID() ?? null,
      // Reserve two seconds of the archive's ten-second visible-failure budget
      // for resolution and rendering when the browser emits no format error.
      getTimeoutSeconds: () =>
        this.media?.getRecordingPlaybackOptions()?.loadTimeoutSeconds ??
        MEDIA_LOADING_TIMEOUT_SECONDS,
      isLoadExpected: () =>
        this._shouldLoad() &&
        !this._resolvedMediaController.getError() &&
        !this._getArchiveFailure(),
    });
  }

  public async getMediaPlayerController(): Promise<MediaPlayerController | null> {
    await this.updateComplete;
    return (await this._refProvider.value?.getMediaPlayerController()) ?? null;
  }

  private async _switchToRelatedClipView(): Promise<void> {
    const view = this.viewManagerEpoch?.manager.getView();
    if (
      !this.hass ||
      !view ||
      !this.cameraManager ||
      !this.media ||
      // If this specific media item has no clip, then do nothing (even if all
      // the other media items do).
      !ViewItemClassifier.isEvent(this.media) ||
      !view.query?.hasMediaQueriesOfType(QueryType.Event)
    ) {
      return;
    }

    // Convert the query to a clips equivalent.
    const clipQuery = UnifiedQueryTransformer.convertToClips(view.query);

    await this.viewManagerEpoch?.manager.setViewByParametersWithExistingQuery({
      params: {
        view: 'media',
        query: clipQuery,
      },
      queryExecutorOptions: {
        selectResult: {
          id: this.media.getID() ?? undefined,
        },
        rejectResults: (results) => !results.hasSelectedResult(),
      },
    });
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has('media') && !this._getArchiveFailure()) {
      this._archiveFailure = null;
    }
    if (
      changedProps.has('media') &&
      this._archiveLiveness &&
      this._archiveLivenessContentID !== this.media?.getContentID()
    ) {
      this._archiveLiveness.unsubscribe();
      this._archiveLiveness = null;
    }
    if (this.media?.getRecordingPlaybackOptions() && !this._archiveLiveness) {
      this._archiveLivenessContentID = this.media.getContentID();
      this._archiveLiveness = new MediaPlayerLivenessDetector(this, () => {
        const targetID = this.media?.getID();
        const verdict = this._archiveLiveness?.getVerdict();
        if (targetID && verdict?.state === 'not_live') {
          triggerMediaUnavailableIssue(this, { targetID, reason: 'stalled' });
        } else if (targetID && verdict?.state === 'live') {
          resolveMediaUnavailableIssue(this, { targetID, reason: 'stalled' });
        }
      });
      this._archiveLiveness.subscribe();
    }
    if (changedProps.has('viewerConfig') || changedProps.has('forceSelected')) {
      this._lazyLoadController.setConfiguration({
        lazyLoad: this.viewerConfig?.lazy_load,
        forceSelected: this.forceSelected,
      });
    }

    if (changedProps.has('viewerConfig') && this.viewerConfig?.zoomable) {
      void import('../zoomer.js');
    }
  }

  private _shouldLoad(): boolean {
    return this._lazyLoadController.isLoaded();
  }

  private _getRelevantCameraConfig(): CameraConfig | null {
    const cameraID = this.media?.getCameraID();
    return cameraID
      ? this.cameraManager?.getStore().getCameraConfig(cameraID) ?? null
      : null;
  }

  private _renderContainer(template: TemplateResult): TemplateResult {
    if (!this.media) {
      return template;
    }
    const cameraID = this.media.getCameraID();
    const mediaID = this.media.getID() ?? undefined;
    const cameraConfig = cameraID
      ? this.cameraManager?.getStore().getCameraConfig(cameraID) ?? null
      : null;
    const view = this.viewManagerEpoch?.manager.getView();

    const intermediateTemplate = html` <advanced-camera-card-media-dimensions-container
      @advanced-camera-card:issue:trigger=${this._handleArchiveIssue}
      .dimensionsConfig=${this._getRelevantCameraConfig()?.dimensions}
    >
      ${template}
    </advanced-camera-card-media-dimensions-container>`;

    return html`
      ${this.viewerConfig?.zoomable
        ? html`<advanced-camera-card-zoomer
            .defaultSettings=${guard([cameraConfig?.dimensions?.layout], () =>
              cameraConfig?.dimensions?.layout
                ? {
                    pan: cameraConfig.dimensions.layout.pan,
                    zoom: cameraConfig.dimensions.layout.zoom,
                  }
                : undefined,
            )}
            .settings=${mediaID ? view?.context?.zoom?.[mediaID]?.requested : undefined}
            @advanced-camera-card:zoom:zoomed=${async () =>
              (await this.getMediaPlayerController())?.setControls(false)}
            @advanced-camera-card:zoom:unzoomed=${async () =>
              (await this.getMediaPlayerController())?.setControls()}
            @advanced-camera-card:zoom:change=${(
              ev: CustomEvent<ZoomSettingsObserved>,
            ) =>
              handleZoomSettingsObservedEvent(
                ev,
                this.viewManagerEpoch?.manager,
                mediaID,
              )}
          >
            ${intermediateTemplate}
          </advanced-camera-card-zoomer>`
        : intermediateTemplate}
    `;
  }

  protected render(): TemplateResult | void {
    if (!this._shouldLoad() || !this.media || !this.hass || !this.viewerConfig) {
      return;
    }

    const archiveFailure = this._getArchiveFailure();
    if (archiveFailure) {
      return renderNotificationBlockFromText(archiveFailure);
    }
    const resolutionError = this._resolvedMediaController.getError();
    if (resolutionError instanceof RecordingPlaybackError) {
      return renderNotificationBlockFromText(resolutionError.message);
    }
    const error = this._signedURLController.getError();
    if (error) {
      const contentID = this.media?.getContentID();
      return renderNotificationBlockFromText(getSignedURLErrorText(error), {
        ...(contentID && { metadata: [{ text: contentID, icon: 'mdi:identifier' }] }),
      });
    }

    const url = this._signedURLController.getValue();
    if (!url) {
      return renderProgressIndicator({
        cardWideConfig: this.cardWideConfig,
      });
    }

    // Note: crossorigin="anonymous" is required on <video> below in order to
    // allow screenshot of motionEye videos which currently go cross-origin.
    const mediaID = this.media.getID() ?? undefined;
    const { isHLS, isVideo } = classifyMimeType(
      this._resolvedMediaController.getValue()?.mime_type,
    );

    return this._renderContainer(html`
      ${isVideo
        ? isHLS
          ? html`<advanced-camera-card-ha-hls-player
              ${ref(this._refProvider)}
              allow-exoplayer
              aria-label="${this.media.getTitle() ?? ''}"
              ?autoplay=${false}
              controls
              muted
              playsinline
              title="${this.media.getTitle() ?? ''}"
              url=${url}
              .hass=${this.hass}
              .targetID=${mediaID}
              ?controls=${this.viewerConfig.controls.builtin}
            >
            </advanced-camera-card-ha-hls-player>`
          : html`
              <advanced-camera-card-video-player
                ${ref(this._refProvider)}
                .archive=${!!this.media.getRecordingPlaybackOptions()}
                .playbackOptions=${this.media.getRecordingPlaybackOptions() ?? undefined}
                url=${url}
                aria-label="${this.media.getTitle() ?? ''}"
                title="${this.media.getTitle() ?? ''}"
                .targetID=${mediaID}
                ?controls=${this.viewerConfig.controls.builtin}
              >
              </advanced-camera-card-video-player>
            `
        : html`<advanced-camera-card-image-player
            ${ref(this._refProvider)}
            url="${url}"
            aria-label="${this.media.getTitle() ?? ''}"
            title="${this.media.getTitle() ?? ''}"
            .targetID=${mediaID}
            @click=${() => {
              if (this.viewerConfig?.snapshot_click_plays_clip) {
                void this._switchToRelatedClipView();
              }
            }}
          ></advanced-camera-card-image-player>`}
    `);
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(viewerProviderStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-viewer-provider': AdvancedCameraCardViewerProvider;
  }
}
