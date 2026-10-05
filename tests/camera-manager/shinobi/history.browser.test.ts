import { assert, expect, it } from 'vitest';

import '../../../src/components/timeline';

import type { AdvancedCameraCardTimelineCore } from '../../../src/components/timeline-core';
import type { AdvancedCameraCardViewerProvider } from '../../../src/components/viewer/provider';
import { deepQuery, deepQueryAll } from '../../browser/dom';
import { FakeHASS } from '../../browser/fake-hass';
import { createFixtureURL } from '../../browser/fixtures';
import { MountedCardFactory, type MountedCard } from '../../browser/mounted-card';
import { RESIZE_LOOP_CONSOLE_ERROR } from '../../browser/test-utils';

const mount = async (
  mediaURL = createFixtureURL('shinobi-4k-h264.mp4'),
  browseGate?: (lower: number, upper: number) => Promise<void>,
) => {
  const start = new Date('2026-10-02T12:34:00Z');
  const end = new Date('2026-10-02T12:36:00Z');
  const id = `v1-${'a'.repeat(64)}`;
  const contentID = `media-source://shinobi_recordings/clip|preview|garden|${id}|${start.getTime() / 1000}|${end.getTime() / 1000}`;
  const laterStart = new Date('2026-10-02T16:09:00Z');
  const laterEnd = new Date('2026-10-02T16:11:00Z');
  const laterID = `media-source://shinobi_recordings/clip|preview|garden|v1-${'b'.repeat(64)}|${laterStart.getTime() / 1000}|${laterEnd.getTime() / 1000}`;
  const clips = [
    { start, end, contentID },
    { start: laterStart, end: laterEnd, contentID: laterID },
  ];
  const hass = new FakeHASS({
    entities: {
      'camera.archive': {
        state: 'idle',
        attributes: {
          shinobi_recordings_entry: 'preview',
          shinobi_recordings_monitor: 'garden',
        },
      },
    },
    registry: { 'camera.archive': { platform: 'shinobi_recordings' } },
  });
  hass.registerCommand('media_source/browse_media', async (message) => {
    const identifier = String(message.media_content_id);
    const parts = identifier.split('|');
    const lower = Number(parts[3]) * 1000;
    const upper = Number(parts[4]) * 1000;
    await browseGate?.(lower, upper);
    return {
      title: 'Window',
      media_class: 'directory',
      media_content_type: 'application/x-directory',
      media_content_id: identifier,
      can_play: false,
      can_expand: true,
      thumbnail: null,
      children: clips
        .filter((clip) => lower < clip.end.getTime() && upper > clip.start.getTime())
        .map((clip) => ({
          title: 'Original recording',
          media_class: 'video',
          media_content_type: 'video/mp4',
          media_content_id: clip.contentID,
          can_play: true,
          can_expand: false,
          thumbnail: null,
        })),
    };
  });
  hass.registerMediaSource(
    /^media-source:\/\/shinobi_recordings\/clip\|/,
    (contentID) => ({
      url: `${mediaURL}${mediaURL.includes('?') ? '&' : '?'}clip=${contentID.includes('b'.repeat(64)) ? 'b' : 'a'}`,
      mime_type: 'video/mp4',
    }),
  );
  const card = await MountedCardFactory.createFromSource(
    {
      type: 'custom:advanced-camera-card',
      cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
      view: { default: 'timeline' },
      timeline: { show_recordings: true },
      media_viewer: { controls: { timeline: { mode: 'below' } } },
    },
    hass,
    { toleratedConsoleErrors: [RESIZE_LOOP_CONSOLE_ERROR] },
  );
  await card.waitForSelector<HTMLElement>('.vis-panel.vis-center');
  return card;
};

const choose = async (
  card: MountedCard,
  instant: Date,
): Promise<AdvancedCameraCardTimelineCore> => {
  const visibleCore = () =>
    deepQueryAll<AdvancedCameraCardTimelineCore>(
      card.card,
      'advanced-camera-card-timeline-core',
    ).find((element) => element.getBoundingClientRect().height > 0);
  await expect.poll(() => !!visibleCore()).toBe(true);
  const core = visibleCore();
  assert(core);
  const picker = deepQuery<HTMLInputElement>(core, 'input[type="datetime-local"]');
  assert(picker);
  // Exercise the rendered native input's change boundary. The OS calendar
  // popup itself is outside this browser harness.
  picker.value = instant.toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16);
  let chosen: Date | null = null;
  card.card.addEventListener('advanced-camera-card:date-picker:change', (event) => {
    chosen = (event as CustomEvent<{ date: Date }>).detail.date;
  });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await expect.poll(() => chosen?.getTime()).toBe(instant.getTime());
  expect(picker.value).not.toBe('');
  await expect
    .poll(() =>
      core.viewManagerEpoch?.manager.getView()?.context?.mediaViewer?.seek?.getTime(),
    )
    .toBe(instant.getTime());
  return core;
};

const getSelectedVideo = (card: MountedCard): HTMLVideoElement | null => {
  const provider = deepQueryAll<AdvancedCameraCardViewerProvider>(
    card.card,
    'advanced-camera-card-viewer-provider',
  ).find((provider) => provider.forceSelected);
  return provider ? deepQuery<HTMLVideoElement>(provider, 'video') : null;
};

const waitForSelectedFrame = async (card: MountedCard): Promise<HTMLVideoElement> => {
  await card.events.waitForFirst('advanced-camera-card:media:loaded');
  const video = getSelectedVideo(card);
  assert(video);
  await expect.poll(() => video.currentTime).toBeGreaterThanOrEqual(59);
  expect(video.currentTime).toBeLessThanOrEqual(61);
  expect(video.videoWidth).toBe(3840);
  expect(video.videoHeight).toBe(2160);
  await expect
    .poll(() => !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
    .toBe(true);
  return video;
};

const timings = { cold: [] as number[], warm: [] as number[] };
for (const mode of ['cold', 'warm'] as const) {
  if (mode === 'warm') {
    it('primes the exact warm media cache key before collecting measurements', async () => {
      const card = await mount(createFixtureURL('shinobi-4k-h264.mp4'));
      await choose(card, new Date('2026-10-02T12:35:00Z'));
      await waitForSelectedFrame(card);
    });
  }
  it.each(Array.from({ length: 20 }, (_, index) => index))(
    `selects and decodes a historical 4K frame (${mode} run %i)`,
    async (index) => {
      // A fresh card clears card metadata/resolution caches. Cold media URLs
      // are unique; warm runs reuse the same browser HTTP-cache key.
      const url = createFixtureURL('shinobi-4k-h264.mp4');
      const card = await mount(mode === 'cold' ? `${url}?cold=${index}` : url);
      const before = performance.now();
      await choose(card, new Date('2026-10-02T12:35:00Z'));
      await waitForSelectedFrame(card);
      timings[mode].push(performance.now() - before);
    },
    30000,
  );
}

it('shows no selected recording in a complete gap', async () => {
  const card = await mount();
  const core = await choose(card, new Date('2026-10-02T12:37:00Z'));
  await expect
    .poll(() =>
      core.viewManagerEpoch?.manager.getView()?.queryResults?.hasSelectedResult(),
    )
    .toBe(false);
  await expect.poll(() => deepQuery(card.card, 'video')).toBeNull();
});

it('ignores late discovery after another time is selected', async () => {
  const deferred: { release?: () => void } = {};
  const delayed = new Promise<void>((resolve) => {
    deferred.release = resolve;
  });
  let pending = false;
  let hold = true;
  const url = createFixtureURL('shinobi-4k-h264.mp4');
  const card = await mount(url, async (lower, upper) => {
    if (
      hold &&
      lower < new Date('2026-10-02T12:36:00Z').getTime() &&
      upper > new Date('2026-10-02T12:34:00Z').getTime()
    ) {
      pending = true;
      await delayed;
    }
  });
  await choose(card, new Date('2026-10-02T12:35:00Z'));
  await expect.poll(() => pending).toBe(true);
  hold = false;
  const core = await choose(card, new Date('2026-10-02T16:10:00Z'));
  const selectedPlayer = await waitForSelectedFrame(card);
  assert(deferred.release);
  deferred.release();
  // Let the old promise and Lit's following render complete before asserting.
  await delayed;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(
    core.viewManagerEpoch?.manager.getView()?.queryResults?.getSelectedResult()?.getID(),
  ).toBe(`v1-${'b'.repeat(64)}`);
  expect(getSelectedVideo(card)).toBe(selectedPlayer);
  expect(selectedPlayer.currentTime).toBeGreaterThanOrEqual(59);
  expect(selectedPlayer.currentTime).toBeLessThan(120);
  expect(
    core.viewManagerEpoch?.manager.getView()?.context?.mediaViewer?.seek?.toISOString(),
  ).toBe('2026-10-02T16:10:00.000Z');
});

it('meets the first decoded frame budget in twenty cold and twenty warm runs', async ({
  annotate,
  task,
}) => {
  const measurements: unknown[] = [];
  Object.assign(task.meta, { performance: measurements });
  for (const mode of ['cold', 'warm'] as const) {
    expect(timings[mode]).toHaveLength(20);
    const sorted = [...timings[mode]].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const measurement = {
      scenario: 'shinobi-history',
      mode,
      timings: timings[mode],
      p95,
      unit: 'ms',
      browser: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    measurements.push(measurement);
    await annotate(`Shinobi historical playback: ${mode}`, 'performance', {
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
      body: JSON.stringify(measurement, null, 2),
    });
    expect(p95).toBeLessThanOrEqual(5000);
  }
});
