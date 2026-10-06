// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { ShinobiCameraManagerEngine } from '../../../src/camera-manager/shinobi/engine-shinobi';
import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import { CameraManagerRequestCache } from '../../../src/camera-manager/types';
import { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import type { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { ViewMedia, ViewMediaType } from '../../../src/view/item';
import { createCameraConfig } from '../../config/test-utils';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import { createHASS, createHASSManager } from '../../test-utils';

const start = new Date('2026-10-02T12:34:00Z');
const end = new Date('2026-10-02T12:35:00Z');
const contentID = `media-source://shinobi_recordings/clip|preview|garden|v1-${'a'.repeat(64)}|${start.getTime() / 1000}|${end.getTime() / 1000}`;
const engine = () =>
  new ShinobiCameraManagerEngine(
    new EntityRegistryManagerMock(),
    createHASSManager(),
    new BrowseMediaWalker(),
    mock<ResolvedMediaCache>(),
    new CameraManagerRequestCache(),
  );
const recording = (enabled: boolean, id = contentID) =>
  new ShinobiRecording('archive', id, 'fixture', start, end, enabled);
afterEach(() => vi.unstubAllGlobals());

it('advertises download only for an explicitly enabled adapter recording', async () => {
  const instance = engine();
  for (const media of [recording(false), new ViewMedia(ViewMediaType.Clip)]) {
    expect(instance.getMediaCapabilities(media).canDownload).toBe(false);
    expect(
      await instance.getMediaDownloadPath(createHASS(), createCameraConfig(), media),
    ).toBeNull();
  }
  expect(instance.getMediaCapabilities(recording(true))).toEqual({
    canFavorite: false,
    canDownload: true,
  });
});

it('resolves fresh authenticated download identifiers without caching playback URLs', async () => {
  const hass = createHASS();
  vi.mocked(hass.hassUrl).mockReturnValue('https://ha.example/api/download');
  const call = vi.mocked(hass.callWS).mockResolvedValue({
    url: '/api/shinobi_recordings/preview/garden/fixture/download?authSig=synthetic',
    mime_type: 'video/mp4',
  });
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([0]), { status: 206 }));
  vi.stubGlobal('fetch', fetch);
  const instance = engine();
  for (let i = 0; i < 2; i++) {
    expect(
      await instance.getMediaDownloadPath(hass, createCameraConfig(), recording(true)),
    ).toEqual({
      endpoint: hass.hassUrl(
        '/api/shinobi_recordings/preview/garden/fixture/download?authSig=synthetic',
      ),
    });
  }
  expect(call).toHaveBeenCalledTimes(2);
  expect(call).toHaveBeenCalledWith({
    type: 'media_source/resolve_media',
    media_content_id: contentID.replace('/clip|', '/download|'),
  });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
  });
});

it('rejects a malformed download identity before asking HA', async () => {
  const hass = createHASS();
  const call = vi.mocked(hass.callWS);
  await expect(
    engine().getMediaDownloadPath(hass, createCameraConfig(), recording(true, 'bad')),
  ).rejects.toMatchObject({ category: 'metadata' });
  expect(call).not.toHaveBeenCalled();
});
