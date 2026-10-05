import { canonicalizeHAURL } from '../../ha/canonical-url';
import { isHARelativeURL } from '../../ha/is-ha-relative-url';
import {
  resolvedMediaSchema,
  type HomeAssistant,
  type ResolvedMedia,
} from '../../ha/types';
import { homeAssistantWSRequest } from '../../ha/ws-request';
import { withTimeout } from '../../utils/concurrency/with-timeout';
import { archiveError, ShinobiArchiveError } from './errors';

/** A fresh HA resolve renews authorization; signed recording URLs are not cached. */
export async function resolveShinobiMedia(
  hass: HomeAssistant,
  contentID: string,
): Promise<ResolvedMedia> {
  const abort = new AbortController();
  try {
    return await withTimeout(
      (async () => {
        const resolved = await homeAssistantWSRequest(hass, resolvedMediaSchema, {
          type: 'media_source/resolve_media',
          media_content_id: contentID,
        });
        if (
          !isHARelativeURL(resolved.url) ||
          resolved.url.startsWith('//') ||
          resolved.url.includes('\\') ||
          resolved.mime_type !== 'video/mp4'
        ) {
          throw new ShinobiArchiveError('metadata', 'resolve');
        }
        let response: Response;
        try {
          response = await fetch(canonicalizeHAURL(hass, resolved.url), {
            // HA authenticates signed requests only for GET. A one-byte Range
            // probes the authorized original relay without downloading a clip.
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
            signal: abort.signal,
            redirect: 'error',
            cache: 'no-store',
          });
        } catch {
          throw new ShinobiArchiveError('network', 'resolve');
        }
        // Stop the response body immediately after its headers, including when
        // an upstream server ignores Range and returns the entire file.
        abort.abort();
        if (!response.ok) {
          throw new ShinobiArchiveError(
            response.status === 401
              ? 'authentication'
              : response.status === 403
                ? 'denied'
                : response.status === 404 || response.status === 410
                  ? 'unavailable'
                  : 'network',
            'resolve',
          );
        }
        return resolved;
      })(),
      10000,
      new ShinobiArchiveError('timeout', 'resolve'),
    );
  } catch (error) {
    throw archiveError(error, 'resolve');
  } finally {
    abort.abort();
  }
}
