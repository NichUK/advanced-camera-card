import { z } from 'zod';

import { localize } from '../../localize/localize';
import { AdvancedCameraCardError } from '../../types';

export type ShinobiFailure =
  | 'authentication'
  | 'denied'
  | 'unavailable'
  | 'network'
  | 'metadata'
  | 'timeout'
  | 'unsupported'
  | 'decode';

export class ShinobiArchiveError extends AdvancedCameraCardError {
  public readonly category: ShinobiFailure;
  public readonly retryable: boolean;

  constructor(category: ShinobiFailure, stage: 'discovery' | 'resolve' | 'playback') {
    super(localize(`shinobi.errors.${category}`), { category, stage });
    this.category = category;
    this.retryable = category === 'network' || category === 'timeout';
  }
}

const errorCodeSchema = z.object({ code: z.string(), message: z.string().optional() });
const contextSchema = z.object({ response: errorCodeSchema });

/** Recognize stable HA adapter codes; never retain upstream text or URLs. */
export function archiveError(
  error: unknown,
  stage: 'discovery' | 'resolve',
): ShinobiArchiveError {
  if (error instanceof ShinobiArchiveError) {
    return error;
  }
  const wrapped = contextSchema.safeParse(
    error instanceof AdvancedCameraCardError ? error.context : null,
  );
  const raw = errorCodeSchema.safeParse(error);
  const response = wrapped.success
    ? wrapped.data.response
    : raw.success
      ? raw.data
      : null;
  const code =
    response &&
    (response.code === 'browse_media_failed' || response.code === 'resolve_media_failed')
      ? response.message ?? ''
      : response?.code ?? '';
  const categories: Record<string, ShinobiFailure> = {
    authentication_failed: 'authentication',
    unauthorized: 'authentication',
    monitor_not_authorized: 'denied',
    recording_unavailable: 'unavailable',
    recording_not_found: 'unavailable',
    upstream_timeout: 'timeout',
    upstream_unavailable: 'network',
    upstream_http_failure: 'network',
  };
  const transportFailed =
    error instanceof AdvancedCameraCardError &&
    error.message === localize('error.failed_response') &&
    !response?.code;
  return new ShinobiArchiveError(
    categories[code] ?? (transportFailed ? 'network' : 'metadata'),
    stage,
  );
}
