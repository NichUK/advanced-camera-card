import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { resolveMedia, type ResolvedMediaCache } from '../ha/resolved-media.js';
import type { HomeAssistant, ResolvedMedia } from '../ha/types.js';
import { Generation } from '../utils/concurrency/generation.js';

interface ResolvedMediaControllerOptions {
  hass?: HomeAssistant;

  // The media content ID to resolve, or `null` when there is nothing to resolve
  // (e.g. the host is not yet showing this media).
  contentID?: string | null;

  cache?: ResolvedMediaCache | null;
  resolve?: (hass: HomeAssistant, contentID: string) => Promise<ResolvedMedia>;
  onError?: (error: unknown) => void;
  transformError?: (error: unknown) => unknown;
}

/**
 * Resolves a media content ID to the media it refers to.
 */
export class ResolvedMediaController implements ReactiveController {
  private _host: ReactiveControllerHost;
  private _getOptionsCallback: () => ResolvedMediaControllerOptions;

  private _value: ResolvedMedia | null = null;
  private _error: unknown = null;

  // Inputs of the last request.
  private _targetContentID: string | null = null;
  private _targetCache: ResolvedMediaCache | null = null;
  private _targetResolver: ResolvedMediaControllerOptions['resolve'];

  private _requestGeneration = new Generation();

  constructor(
    host: ReactiveControllerHost,
    getOptionsCallback: () => ResolvedMediaControllerOptions,
  ) {
    (this._host = host).addController(this);
    this._getOptionsCallback = getOptionsCallback;
  }

  public getValue(): ResolvedMedia | null {
    return this._value;
  }

  public getError(): unknown {
    return this._error;
  }

  public hostDisconnected(): void {
    this._requestGeneration.invalidate();
    this._value = null;
    this._error = null;
    this._targetContentID = null;
    this._targetCache = null;
    this._targetResolver = undefined;
  }

  public async hostUpdate(): Promise<void> {
    const { hass, contentID, cache, resolve, onError, transformError } =
      this._getOptionsCallback();

    if (!hass || !contentID) {
      // Invalidate any in-flight request so a stale result cannot repopulate
      // the controller after the inputs have been cleared.
      this._requestGeneration.invalidate();
      this._value = null;
      this._error = null;
      this._targetContentID = null;
      this._targetCache = null;
      this._targetResolver = undefined;
      return;
    }

    const targetCache = resolve ? null : cache ?? null;
    if (
      contentID === this._targetContentID &&
      targetCache === this._targetCache &&
      resolve === this._targetResolver
    ) {
      return;
    }

    this._targetContentID = contentID;
    this._targetCache = targetCache;
    this._targetResolver = resolve;
    this._error = null;

    // Read the cache here rather than leaving it to resolveMedia below, so a
    // hit can return without waiting.
    const cached = targetCache?.get(contentID) ?? null;
    if (cached) {
      this._requestGeneration.invalidate();
      this._value = cached;
      return;
    }

    this._value = null;
    this._error = null;

    const requestID = this._requestGeneration.next();
    let resolved: ResolvedMedia | null;
    if (resolve) {
      try {
        resolved = await resolve(hass, contentID);
      } catch (error) {
        if (this._requestGeneration.isCurrent(requestID)) {
          this._error = transformError ? transformError(error) : error;
          onError?.(this._error);
          this._host.requestUpdate();
        }
        return;
      }
    } else {
      resolved = await resolveMedia(hass, contentID, targetCache);
    }
    if (!this._requestGeneration.isCurrent(requestID)) {
      return;
    }

    this._value = resolved;
    this._host.requestUpdate();
  }
}
