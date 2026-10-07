import { assert, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../../src/components/timeline';

import type { AdvancedCameraCardTimelineCore } from '../../../src/components/timeline-core';
import type { AdvancedCameraCardViewerProvider } from '../../../src/components/viewer/provider';
import { deepQuery, deepQueryAll } from '../../browser/dom';
import { FakeHASS } from '../../browser/fake-hass';
import { createFixtureURL } from '../../browser/fixtures';
import { MountedCardFactory, type MountedCard } from '../../browser/mounted-card';
import { RESIZE_LOOP_CONSOLE_ERROR } from '../../browser/test-utils';

const start = new Date('2026-10-02T12:34:00Z');
const video = (card: MountedCard): HTMLVideoElement | null => {
  const provider = deepQueryAll<AdvancedCameraCardViewerProvider>(
    card.card,
    'advanced-camera-card-viewer-provider',
  ).find((item) => item.forceSelected);
  return provider ? deepQuery<HTMLVideoElement>(provider, 'video') : null;
};
const current = (card: MountedCard) =>
  deepQueryAll<AdvancedCameraCardTimelineCore>(
    card.card,
    'advanced-camera-card-timeline-core',
  )
    .find((core) => core.getBoundingClientRect().height > 0)
    ?.viewManagerEpoch?.manager.getView();

const mount = async (
  offsets: number[],
  gate?: (lower: number, upper: number) => Promise<void>,
) => {
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
  hass.registerCommand('media_source/browse_media', async (message) => {
    const parts = String(message.media_content_id).split('|');
    const lower = Number(parts[3]) * 1000,
      upper = Number(parts[4]) * 1000;
    await gate?.(lower, upper);
    return {
      title: 'Quiet recordings',
      media_class: 'directory',
      media_content_type: 'application/x-directory',
      media_content_id: message.media_content_id,
      can_play: false,
      can_expand: true,
      thumbnail: null,
      children: offsets
        .filter(
          (offset) =>
            start.getTime() + offset * 1000 < upper &&
            start.getTime() + (offset + 1) * 1000 > lower,
        )
        .map((offset) => ({
          title: 'Original recording',
          media_class: 'video',
          media_content_type: 'video/mp4',
          media_content_id: `media-source://shinobi_recordings/clip|preview|garden|v1-${offset.toString(16).padStart(64, '0')}|${start.getTime() / 1000 + offset}|${start.getTime() / 1000 + offset + 1}`,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        })),
    };
  });
  hass.registerMediaSource(
    /^media-source:\/\/shinobi_recordings\/clip\|/,
    (contentID) => ({
      url:
        createFixtureURL('shinobi-4k-one-second.mp4') +
        '?clip=' +
        contentID.split('|')[3],
      mime_type: 'video/mp4',
    }),
  );
  const card = await MountedCardFactory.createFromSource(
    {
      type: 'custom:advanced-camera-card',
      cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
      view: { default: 'timeline' },
      timeline: { show_recordings: true },
      media_viewer: {
        controls: {
          // This fixture has no thumbnails; keep the drawer out of the pointer journey.
          thumbnails: { mode: 'none' },
          timeline: { mode: 'below', show_recordings: true },
        },
      },
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
  input.value = '2026-10-02T14:34';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await expect
    .poll(() => video(card)?.readyState, { timeout: 5000 })
    .toBeGreaterThanOrEqual(HTMLMediaElement.HAVE_CURRENT_DATA);
  expect(video(card)?.videoWidth).toBe(3840);
  return card;
};

it('moves the playhead into the next recording after a natural file ending', async () => {
  const card = await mount([0, 1]);
  await expect
    .poll(() => current(card)?.context?.mediaViewer?.seek?.getTime(), { timeout: 5000 })
    .toBe(start.getTime() + 1000);
  const expected = new Date(start.getTime() + 1000).toLocaleString('sv-SE');
  await expect
    .poll(() => deepQuery<HTMLElement>(card.card, '.playback_bar')?.textContent)
    .toBe(expected);
  await expect
    .poll(() => video(card)?.currentSrc.includes('v1-' + '1'.padStart(64, '0')))
    .toBe(true);
  await expect.poll(() => video(card)?.readyState).toBeGreaterThanOrEqual(3);
  const next = video(card);
  assert(next);
  next.pause();
  next.currentTime = 0.2;
  await expect.poll(() => next.seeking).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const marker = deepQuery<HTMLElement>(card.card, '.playback_bar');
  assert(marker);
  const earlier = marker.getBoundingClientRect().left;
  next.currentTime = 0.7;
  await expect.poll(() => marker.getBoundingClientRect().left).toBeGreaterThan(earlier);
});

it('plays twenty natural adjacent-file handoffs once without skipping chronology', async ({
  task,
}) => {
  const card = await mount(Array.from({ length: 21 }, (_, index) => index));
  const ended: number[] = [];
  card.card.addEventListener('advanced-camera-card:media:ended', () =>
    ended.push(performance.now()),
  );
  const observations: number[] = [];
  for (let index = 1; index <= 20; index++) {
    const previous = video(card);
    await expect
      .poll(() => current(card)?.context?.mediaViewer?.seek?.getTime(), {
        timeout: 5000,
      })
      .toBe(start.getTime() + index * 1000);
    await expect
      .poll(
        () =>
          video(card) !== previous &&
          (video(card)?.readyState ?? 0) >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          !video(card)?.paused,
        { timeout: 5000 },
      )
      .toBe(true);
    assert(ended[index - 1] !== undefined);
    observations.push(performance.now() - ended[index - 1]);
  }
  const p95 = [...observations].sort((a, b) => a - b)[18];
  Object.assign(task.meta, {
    handoffPerformance: {
      observations,
      p95,
      unit: 'ms',
      browser: navigator.userAgent,
      codec: 'synthetic H264 3840x2160',
      duration: 1,
    },
  });
  expect(p95).toBeLessThanOrEqual(2000);
  await expect
    .poll(
      () => deepQuery<HTMLElement>(card.card, '.recording-continuation')?.textContent,
      { timeout: 5000 },
    )
    .toContain('End of available recording history');
  expect(ended).toHaveLength(21);
}, 60000);

it('stops at a thirty-six-second gap until the next recording is explicitly chosen', async () => {
  const card = await mount([0, 37]);
  await expect
    .poll(
      () => deepQuery<HTMLElement>(card.card, '.recording-continuation')?.textContent,
      { timeout: 5000 },
    )
    .toContain('Recording gap');
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
  expect(video(card)?.paused).toBe(true);
  const next = deepQuery<HTMLButtonElement>(card.card, '.recording-continuation button');
  assert(next);
  await userEvent.click(next);
  await expect
    .poll(() => current(card)?.context?.mediaViewer?.seek?.getTime())
    .toBe(start.getTime() + 37000);
  await expect.poll(() => video(card)?.paused).toBe(false);
});

it.each(['pause', 'seek', 'dispose'])(
  'cancels pending next-file metadata on %s without a late player switch',
  async (action) => {
    let delayed = false;
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const card = await mount([0, 1], async () => {
      if (delayed) {
        await pending;
      }
    });
    delayed = true;
    await expect
      .poll(
        () => deepQuery<HTMLElement>(card.card, '.recording-continuation')?.textContent,
        { timeout: 5000 },
      )
      .toContain('Finding the next recording');
    const provider = deepQueryAll<AdvancedCameraCardViewerProvider>(
      card.card,
      'advanced-camera-card-viewer-provider',
    ).find((item) => item.forceSelected);
    assert(provider);
    if (action === 'pause') {
      await (await provider.getMediaPlayerController())?.playback?.pause();
    } else if (action === 'seek') {
      const input = deepQuery<HTMLInputElement>(
        card.card,
        'input[type="datetime-local"]',
      );
      assert(input);
      // A real manual selection of the same interval supersedes continuation.
      input.value = '2026-10-02T14:34';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      card.card.remove();
    }
    assert(finish);
    finish();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (action !== 'dispose') {
      expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
      if (action === 'pause') {
        expect(video(card)).toBe(deepQuery<HTMLVideoElement>(provider, 'video'));
        expect(video(card)?.paused).toBe(true);
      } else {
        // Manual selection may rebuild the player; its selected file must
        // remain the manually chosen first clip after old work is released.
        await expect
          .poll(() => video(card)?.currentSrc)
          .toContain('v1-' + '0'.repeat(64));
      }
    } else {
      expect(card.card.isConnected).toBe(false);
    }
  },
);

it('shows missing next metadata as unavailable instead of advancing or claiming the end of history', async () => {
  const offsets = [0, 1];
  const card = await mount(offsets);
  // Retention removes the candidate after the earlier viewport snapshot.
  offsets.splice(1, 1);
  await expect
    .poll(
      () => deepQuery<HTMLElement>(card.card, '.recording-continuation')?.textContent,
      { timeout: 5000 },
    )
    .toContain('Next recording unavailable');
  expect(current(card)?.context?.mediaViewer?.seek?.getTime()).toBe(start.getTime());
  expect(video(card)?.paused).toBe(true);
});
