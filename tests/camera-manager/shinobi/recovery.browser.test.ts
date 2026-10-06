import { assert, expect, it, vi } from 'vitest';

import '../../../src/components/timeline';
import '../../../src/components/video-player';

import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import { VideoMediaPlayerController } from '../../../src/components-lib/media-player/video';
import type { AdvancedCameraCardTimelineCore } from '../../../src/components/timeline-core';
import type { AdvancedCameraCardViewerProvider } from '../../../src/components/viewer/provider';
import { deepQuery, deepQueryAll } from '../../browser/dom';
import { FakeHASS } from '../../browser/fake-hass';
import { createFixtureURL } from '../../browser/fixtures';
import { MountedCardFactory, type MountedCard } from '../../browser/mounted-card';
import {
  createTestMediaURL,
  getTestMediaRequestCount,
  useTestMedia,
} from '../../browser/test-media';
import {
  getBlockNotificationText,
  RESIZE_LOOP_CONSOLE_ERROR,
} from '../../browser/test-utils';

useTestMedia();

it('releases archive transport on disconnect and reloads a reconnected player', async () => {
  const player = document.createElement('advanced-camera-card-video-player');
  player.archive = true;
  player.targetID = 'archive';
  player.url = createFixtureURL('shinobi-4k-h264.mp4');
  const loaded = vi.fn();
  player.addEventListener('advanced-camera-card:media:loaded', loaded);
  document.body.append(player);
  await expect
    .poll(() => player.shadowRoot?.querySelector('video')?.videoWidth)
    .toBe(3840);
  const video = player.shadowRoot?.querySelector('video');
  assert(video);
  player.remove();
  // HA's scoped-registry polyfill delivers disconnect reactions asynchronously.
  await expect.poll(() => video.querySelector('source')?.getAttribute('src')).toBeNull();
  expect(video.readyState).toBe(0);
  expect(video.paused).toBe(true);
  loaded.mockClear();
  document.body.append(player);
  expect(loaded).not.toHaveBeenCalled();
  await expect.poll(() => video.videoWidth).toBe(3840);
  await expect.poll(() => loaded.mock.calls.length).toBe(1);
  player.remove();
});
const start = new Date('2026-10-02T12:34:00Z');
const contentID = `media-source://shinobi_recordings/clip|preview|garden|v1-${'a'.repeat(64)}|${start.getTime() / 1000}|${start.getTime() / 1000 + 120}`;
const current = (card: MountedCard) =>
  deepQueryAll<AdvancedCameraCardTimelineCore>(
    card.card,
    'advanced-camera-card-timeline-core',
  )
    .find((core) => core.getBoundingClientRect().height > 0)
    ?.viewManagerEpoch?.manager.getView();

const mount = async (url: string, retrySeconds = 0.1) => {
  const hass = new FakeHASS({
    entities: {
      'camera.archive': {
        state: 'idle',
        attributes: {
          shinobi_recordings_entry: 'preview',
          shinobi_recordings_monitor: 'garden',
          shinobi_recordings_timezone: 'Europe/Paris',
        },
      },
    },
    registry: { 'camera.archive': { platform: 'shinobi_recordings' } },
  });
  let resolves = 0;
  hass.registerMediaSource(/^media-source:\/\/shinobi_recordings\/clip\|/, () => {
    resolves++;
    return { url, mime_type: 'video/mp4' };
  });
  hass.registerCommand('media_source/browse_media', (message) => ({
    title: 'Quiet recordings',
    media_class: 'directory',
    media_content_type: 'application/x-directory',
    media_content_id: message.media_content_id,
    can_play: false,
    can_expand: true,
    thumbnail: null,
    children: [
      {
        title: 'Original recording',
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
      view: { default: 'timeline', issues: { retry_seconds: retrySeconds } },
      timeline: { show_recordings: true },
      media_viewer: { controls: { timeline: { mode: 'below', show_recordings: true } } },
    },
    hass,
    { toleratedConsoleErrors: [RESIZE_LOOP_CONSOLE_ERROR] },
  );
  await card.waitForSelector('.vis-panel.vis-center');
  const core = deepQueryAll<AdvancedCameraCardTimelineCore>(
    card.card,
    'advanced-camera-card-timeline-core',
  ).find((item) => item.getBoundingClientRect().height > 0);
  assert(core);
  const input = deepQuery<HTMLInputElement>(core, 'input[type="datetime-local"]');
  assert(input);
  const began = performance.now();
  input.value = '2026-10-02T14:34';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { card, began, resolves: () => resolves };
};

it('keeps monitoring a loaded player after same-content metadata revalidation', async () => {
  const playback: { callback: ((live: boolean) => void) | null } = { callback: null };
  const subscription = vi
    .spyOn(VideoMediaPlayerController.prototype, 'subscribeLiveness')
    .mockImplementation((callback) => {
      playback.callback = callback;
      return () => {
        playback.callback = null;
      };
    });
  try {
    const { card } = await mount(createFixtureURL('shinobi-4k-h264.mp4'), 0);
    await card.events.waitForFirst('advanced-camera-card:media:loaded');
    await expect.poll(() => playback.callback !== null).toBe(true);
    const provider = deepQuery<AdvancedCameraCardViewerProvider>(
      card.card,
      'advanced-camera-card-viewer-provider',
    );
    assert(provider);
    const old = provider.media;
    assert(old instanceof ShinobiRecording);
    const camera = old.getCameraID();
    assert(camera);
    provider.media = new ShinobiRecording(
      camera,
      old.getContentID(),
      old.getID(),
      old.getStartTime(),
      old.getEndTime(),
    );
    await provider.updateComplete;
    assert(playback.callback);
    playback.callback(false);
    const failure = await card.events.waitForFirst('advanced-camera-card:issue:trigger');
    expect(failure.detail).toMatchObject({
      key: 'media_unavailable',
      reason: 'stalled',
    });
    await card.clickControl('Media unavailable');
  } finally {
    subscription.mockRestore();
  }
});

it('shows deleted media promptly, stops automatic retries, and explicitly renews HA access', async () => {
  const url = createTestMediaURL([404, 200], true, 'shinobi-4k-h264.mp4');
  const { card, began, resolves } = await mount(url);
  await card.events.waitForFirst('advanced-camera-card:issue:trigger');
  await expect
    .poll(() => getBlockNotificationText(card.card))
    .toContain('expired or deleted');
  expect(performance.now() - began).toBeLessThanOrEqual(10000);
  const requested = current(card)?.context?.mediaViewer?.seek?.getTime();
  expect(requested).toBe(start.getTime());
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(getTestMediaRequestCount(url)).toBe(1);
  await card.clickControl('Media unavailable');
  await card.clickControl('Retry');
  await expect
    .poll(() => deepQuery<HTMLVideoElement>(card.card, 'video')?.videoWidth, {
      timeout: 5000,
    })
    .toBe(3840);
  await card.events.waitForFirst('advanced-camera-card:media:loaded');
  expect(resolves()).toBeGreaterThanOrEqual(2);
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(requested);
  expect(deepQuery<HTMLVideoElement>(card.card, 'video')?.videoWidth).toBe(3840);
});

it('recovers from a temporary server failure without changing the historical instant', async () => {
  const url = createTestMediaURL([503, 200], true, 'shinobi-4k-h264.mp4');
  const { card, resolves } = await mount(url);
  await card.events.waitForFirst('advanced-camera-card:issue:trigger');
  await expect
    .poll(() => deepQuery<HTMLVideoElement>(card.card, 'video')?.videoWidth, {
      timeout: 5000,
    })
    .toBe(3840);
  await card.events.waitForFirst('advanced-camera-card:media:loaded');
  expect(resolves()).toBeGreaterThanOrEqual(2);
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
  expect(current(card)?.view).toBe('media');
});

it('recovers when the MP4 fails after its successful authorization preflight', async () => {
  const url = createTestMediaURL([200, 503, 503, 200], true, 'shinobi-4k-h264.mp4');
  const { card, resolves } = await mount(url);
  await card.events.waitForFirst('advanced-camera-card:issue:trigger');
  await expect
    .poll(() => deepQuery<HTMLVideoElement>(card.card, 'video')?.videoWidth, {
      timeout: 5000,
    })
    .toBe(3840);
  expect(resolves()).toBeGreaterThanOrEqual(2);
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
});

it('reports an actionable failure for non-video bytes instead of leaving the spinner', async () => {
  const { card, began } = await mount(createFixtureURL('still-red.png'));
  const issue = await card.events.waitForFirst('advanced-camera-card:issue:trigger');
  expect(issue.detail).toMatchObject({ key: 'media_unavailable' });
  await card.clickControl('Media unavailable');
  await expect
    .poll(
      () =>
        deepQuery<HTMLElement>(card.card, 'advanced-camera-card-notification')
          ?.shadowRoot?.textContent,
    )
    .toMatch(/does not support|Stream stalled/);
  expect(performance.now() - began).toBeLessThanOrEqual(10000);
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
});

it('reports unsupported archive video when only its audio track can decode', async () => {
  const { card, began } = await mount(createFixtureURL('shinobi-audio-only.mp4'));
  await card.events.waitForFirst('advanced-camera-card:issue:trigger');
  await card.clickControl('Media unavailable');
  await expect
    .poll(
      () =>
        deepQuery<HTMLElement>(card.card, 'advanced-camera-card-notification')
          ?.shadowRoot?.textContent,
    )
    .toContain('does not support');
  await expect
    .poll(() => getBlockNotificationText(card.card))
    .toContain('does not support');
  expect(deepQuery<HTMLVideoElement>(card.card, 'video')).toBeNull();
  expect(performance.now() - began).toBeLessThanOrEqual(10000);
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  try {
    await vi.advanceTimersByTimeAsync(31000);
    expect(getBlockNotificationText(card.card)).toContain('does not support');
    expect(deepQuery<HTMLVideoElement>(card.card, 'video')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('measures twenty categorized HTTP failures through the rendered archive viewer', async ({
  task,
}) => {
  const observations: { status: number; milliseconds: number }[] = [];
  for (const status of [401, 403, 404, 503]) {
    for (let repetition = 0; repetition < 5; repetition++) {
      const url = createTestMediaURL([status], true, 'shinobi-4k-h264.mp4');
      const { card, began } = await mount(url, 0);
      await card.events.waitForFirst('advanced-camera-card:issue:trigger');
      const text =
        status === 401
          ? 'authorization expired'
          : status === 403
            ? 'do not have access'
            : status === 404
              ? 'expired or deleted'
              : 'server unavailable';
      await expect.poll(() => getBlockNotificationText(card.card)).toContain(text);
      const milliseconds = performance.now() - began;
      observations.push({ status, milliseconds });
      expect(milliseconds).toBeLessThanOrEqual(10000);
      expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
      expect(getTestMediaRequestCount(url)).toBe(1);
      card.destroy();
    }
  }
  Object.assign(task.meta, {
    failurePerformance: {
      observations,
      p95: observations.map((row) => row.milliseconds).sort((a, b) => a - b)[18],
      browser: navigator.userAgent,
      boundary:
        'HA resolve + service-worker HTTP GET Range status + rendered failure; synthetic media',
    },
  });
});
