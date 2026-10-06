import { assert, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { z } from 'zod';

import '../../../src/components/timeline';

import { deepQuery } from '../../browser/dom';
import { FakeHASS } from '../../browser/fake-hass';
import { createFixtureURL } from '../../browser/fixtures';
import { MountedCardFactory } from '../../browser/mounted-card';
import { RESIZE_LOOP_CONSOLE_ERROR } from '../../browser/test-utils';

declare module 'vitest/browser' {
  interface BrowserCommands {
    startDownload: () => Promise<void>;
    finishDownload: () => Promise<unknown>;
  }
}

it('downloads the selected original fixture through the rendered normal Download action', async ({
  task,
}) => {
  const start = new Date('2026-10-02T12:34:00Z');
  const contentID = `media-source://shinobi_recordings/clip|preview|garden|v1-${'a'.repeat(64)}|${start.getTime() / 1000}|${start.getTime() / 1000 + 120}`;
  const hass = new FakeHASS({
    entities: {
      'camera.archive': {
        state: 'idle',
        attributes: {
          shinobi_recordings_entry: 'preview',
          shinobi_recordings_monitor: 'garden',
          shinobi_recordings_timezone: 'Europe/Paris',
          shinobi_recordings_download: true,
        },
      },
    },
    registry: { 'camera.archive': { platform: 'shinobi_recordings' } },
  });
  const resolved: string[] = [];
  hass.registerMediaSource(
    /^media-source:\/\/shinobi_recordings\/(clip|download)\|/,
    (id) => {
      resolved.push(id);
      return { url: createFixtureURL('shinobi-4k-h264.mp4'), mime_type: 'video/mp4' };
    },
  );
  hass.registerCommand('media_source/browse_media', (message) => ({
    title: 'Fixture',
    media_class: 'directory',
    media_content_type: 'application/x-directory',
    media_content_id: message.media_content_id,
    can_play: false,
    can_expand: true,
    thumbnail: null,
    children: [
      {
        title: 'Original fixture',
        media_class: 'video',
        media_content_type: 'video/mp4',
        media_content_id: contentID,
        can_play: true,
        can_expand: false,
        thumbnail: null,
      },
    ].filter(() => {
      const parts = String(message.media_content_id).split('|');
      return (
        start.getTime() < Number(parts[4]) * 1000 &&
        start.getTime() + 120000 > Number(parts[3]) * 1000
      );
    }),
  }));
  const card = await MountedCardFactory.createFromSource(
    {
      type: 'custom:advanced-camera-card',
      cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
      menu: {
        style: 'outside',
        buttons: { download: { enabled: true, permanent: true } },
      },
      view: { default: 'timeline' },
      timeline: { show_recordings: true },
      media_viewer: { controls: { thumbnails: { mode: 'none' } } },
    },
    hass,
    { toleratedConsoleErrors: [RESIZE_LOOP_CONSOLE_ERROR] },
  );
  await card.waitForSelector('input[type="datetime-local"]');
  const input = deepQuery<HTMLInputElement>(card.card, 'input[type="datetime-local"]');
  assert(input);
  input.value = '2026-10-02T14:34:00';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await expect
    .poll(() => deepQuery<HTMLVideoElement>(card.card, 'video')?.videoWidth)
    .toBe(3840);
  await commands.startDownload();
  await card.clickControl('Download');
  const result = z
    .object({
      filename: z.string(),
      sha256: z.string(),
      expected_sha256: z.string(),
      size: z.number(),
    })
    .parse(await commands.finishDownload());
  Object.assign(task.meta, { download: result, browser: navigator.userAgent });
  expect(result.sha256).toBe(result.expected_sha256);
  expect(result.size).toBeGreaterThan(0);
  expect(result.filename).toMatch(/^[a-z0-9_-]+\.mp4$/);
  expect(resolved).toContain(contentID.replace('/clip|', '/download|'));
});
