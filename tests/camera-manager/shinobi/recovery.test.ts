// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import {
  archiveError,
  ShinobiArchiveError,
} from '../../../src/camera-manager/shinobi/errors';
import { resolveShinobiMedia } from '../../../src/camera-manager/shinobi/resolve';
import { localize } from '../../../src/localize/localize';
import { AdvancedCameraCardError } from '../../../src/types';
import { createHASS, flushPromises } from '../../test-utils';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('maps only known server categories without retaining secret-bearing context', () => {
  for (const [code, category] of Object.entries({
    authentication_failed: 'authentication',
    unauthorized: 'authentication',
    monitor_not_authorized: 'denied',
    recording_unavailable: 'unavailable',
    recording_not_found: 'unavailable',
    upstream_timeout: 'timeout',
    upstream_unavailable: 'network',
    upstream_http_failure: 'network',
    unknown: 'metadata',
    constructor: 'metadata',
    toString: 'metadata',
  })) {
    for (const value of [
      { code, message: 'SECRET' },
      new AdvancedCameraCardError('SECRET', { request: 'SECRET', response: { code } }),
      new AdvancedCameraCardError('SECRET', {
        response: { code: 'browse_media_failed', message: code },
      }),
      { code: 'resolve_media_failed', message: code },
    ]) {
      const error = archiveError(value, 'discovery');
      expect(error.category).toBe(category);
      expect(JSON.stringify(error.context)).not.toContain('SECRET');
      expect(error.message).not.toContain('SECRET');
    }
  }
  for (const error of [
    null,
    new Error('SECRET'),
    { code: 'browse_media_failed' },
    { code: 'resolve_media_failed', message: 'SECRET' },
  ]) {
    expect(archiveError(error, 'resolve').category).toBe('metadata');
  }
  const error = new ShinobiArchiveError('timeout', 'resolve');
  expect(archiveError(error, 'resolve')).toBe(error);
  expect(
    archiveError(
      new AdvancedCameraCardError(localize('error.failed_response'), {
        response: new Error('SECRET connection reset'),
      }),
      'resolve',
    ).category,
  ).toBe('network');
});

it('renews through HA resolve and checks signed media without sharing a cached URL', async () => {
  const hass = createHASS();
  vi.mocked(hass.hassUrl).mockImplementation((path) => 'https://ha.example' + path);
  vi.mocked(hass.callWS).mockResolvedValue({
    url: '/api/archive?authSig=PRIVATE',
    mime_type: 'video/mp4',
  });
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  for (let i = 0; i < 2; i++) {
    expect(await resolveShinobiMedia(hass, 'opaque')).toEqual({
      url: '/api/archive?authSig=PRIVATE',
      mime_type: 'video/mp4',
    });
  }
  expect(hass.callWS).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith(
    'https://ha.example/api/archive?authSig=PRIVATE',
    expect.objectContaining({ method: 'HEAD', redirect: 'error', cache: 'no-store' }),
  );
});

it('distinguishes actual HTTP failure statuses and rejects external destinations', async () => {
  const hass = createHASS();
  vi.mocked(hass.hassUrl).mockReturnValue('https://ha.example/api/archive');
  vi.mocked(hass.callWS).mockResolvedValue({
    url: '/api/archive',
    mime_type: 'video/mp4',
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const [status, category] of [
    [401, 'authentication'],
    [403, 'denied'],
    [404, 'unavailable'],
    [410, 'unavailable'],
    [503, 'network'],
  ] as const) {
    fetch.mockResolvedValue(new Response(null, { status }));
    await expect(resolveShinobiMedia(hass, 'opaque')).rejects.toMatchObject({
      category,
      context: { category, stage: 'resolve' },
    });
  }
  fetch.mockRejectedValue(new Error('PRIVATE-token-URL'));
  await expect(resolveShinobiMedia(hass, 'opaque')).rejects.toMatchObject({
    category: 'network',
  });
  fetch.mockClear();
  for (const url of [
    'https://external.example/PRIVATE',
    '//external.example/PRIVATE',
    '/\\external.example/PRIVATE',
  ]) {
    vi.mocked(hass.callWS).mockResolvedValue({ url, mime_type: 'video/mp4' });
    await expect(resolveShinobiMedia(hass, 'opaque')).rejects.toMatchObject({
      category: 'metadata',
    });
  }
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(hass.callWS).mockResolvedValue({
    url: '/api/archive',
    mime_type: 'image/jpeg',
  });
  await expect(resolveShinobiMedia(hass, 'opaque')).rejects.toMatchObject({
    category: 'metadata',
  });
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(hass.callWS).mockRejectedValue({
    code: 'resolve_media_failed',
    message: 'monitor_not_authorized',
  });
  await expect(resolveShinobiMedia(hass, 'opaque')).rejects.toMatchObject({
    category: 'denied',
  });
});

it('ends a hung resolve or HEAD at ten seconds and aborts transport', async () => {
  vi.useFakeTimers();
  const hass = createHASS();
  for (const phase of ['resolve', 'head']) {
    vi.mocked(hass.callWS).mockImplementation(() =>
      phase === 'resolve'
        ? new Promise(() => {})
        : Promise.resolve({ url: '/api/archive', mime_type: 'video/mp4' }),
    );
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const work = resolveShinobiMedia(hass, 'opaque');
    const failure = expect(work).rejects.toMatchObject({ category: 'timeout' });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    await failure;
    if (phase === 'head') {
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
  }
});
