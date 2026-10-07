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

const mount = async (
  mediaURL = createFixtureURL('shinobi-4k-h264.mp4'),
  browseGate?: (lower: number, upper: number) => Promise<void>,
  archiveRequests?: { lower: number; upper: number; elapsed: number }[],
  width?: string,
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
  if (archiveRequests) {
    // Fourteen quiet days of one-minute clips. A two-minute overlap at
    // the selected instant exercises the actual decoded fixture. Query responses expose only intersecting intervals.
    const archiveStart = new Date('2026-09-22T00:00:00Z').getTime();
    clips.splice(
      0,
      clips.length,
      ...Array.from({ length: 14 * 1440 }, (_, index) => {
        const clipStart = new Date(archiveStart + index * 60000);
        const clipEnd = new Date(clipStart.getTime() + 60000);
        return {
          start: clipStart,
          end: clipEnd,
          contentID: `media-source://shinobi_recordings/clip|preview|garden|v1-${index.toString(16).padStart(64, '0')}|${clipStart.getTime() / 1000}|${clipEnd.getTime() / 1000}`,
        };
      }),
    );
  }
  if (archiveRequests) {
    clips.push({ start, end, contentID });
  }
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
    const identifier = String(message.media_content_id);
    const parts = identifier.split('|');
    const lower = Number(parts[3]) * 1000;
    const upper = Number(parts[4]) * 1000;
    const before = performance.now();
    await browseGate?.(lower, upper);
    archiveRequests?.push({ lower, upper, elapsed: performance.now() - before });
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
      ...(width ? { dimensions: { height: '624px' } } : {}),
      timeline: { show_recordings: true },
      media_viewer: { controls: { timeline: { mode: 'below', show_recordings: true } } },
    },
    hass,
    { width, toleratedConsoleErrors: [RESIZE_LOOP_CONSOLE_ERROR] },
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
  const timeZone = core.shadowRoot?.querySelector(
    'advanced-camera-card-date-picker',
  )?.timeZone;
  expect(timeZone).toBe('Europe/Paris');
  expect(getComputedStyle(picker).visibility).toBe('visible');
  picker.value = instant
    .toLocaleString('sv-SE', { timeZone })
    .replace(' ', 'T')
    .slice(0, 16);
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
  await expect
    .poll(() => video.currentTime, { timeout: 5000 })
    .toBeGreaterThanOrEqual(59);
  expect(video.currentTime).toBeLessThanOrEqual(61);
  expect(video.videoWidth).toBe(3840);
  expect(video.videoHeight).toBe(2160);
  await expect
    .poll(
      () => !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
      { timeout: 5000 },
    )
    .toBe(true);
  return video;
};

const timings = { cold: [] as number[], warm: [] as number[] };
it.each(['390px', '1664px'])(
  'keeps recording time and date labels inside the card at %s in both timeline views',
  async (width) => {
    const card = await mount(undefined, undefined, undefined, width);
    const checkLabels = async (): Promise<void> => {
      await expect
        .poll(() => {
          const core = deepQueryAll<AdvancedCameraCardTimelineCore>(
            card.card,
            'advanced-camera-card-timeline-core',
          ).find((element) => element.getBoundingClientRect().height > 0);
          if (!core) {
            return false;
          }
          const labels = deepQueryAll<HTMLElement>(core, '.vis-text:not(.vis-measure)');
          const bounds = core.getBoundingClientRect();
          const cardBounds = card.card.getBoundingClientRect();
          return (
            labels.some((label) => label.classList.contains('vis-minor')) &&
            labels.some((label) => label.classList.contains('vis-major')) &&
            labels.every((label) => {
              const box = label.getBoundingClientRect();
              return (
                box.height > 0 &&
                box.top >= bounds.top &&
                box.bottom <= bounds.bottom + 1 &&
                box.bottom <= cardBounds.bottom + 1
              );
            })
          );
        })
        .toBe(true);
    };
    await checkLabels();
    await choose(card, new Date('2026-10-02T12:35:00Z'));
    await waitForSelectedFrame(card);
    await checkLabels();
  },
);

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

it('renders quiet coverage and bounds twenty keyboard viewport changes across a fourteen-day archive', async ({
  task,
}) => {
  const requests: { lower: number; upper: number; elapsed: number }[] = [];
  const card = await mount(undefined, undefined, requests);
  await choose(card, new Date('2026-10-02T12:35:00Z'));
  await waitForSelectedFrame(card);
  const core = deepQueryAll<AdvancedCameraCardTimelineCore>(
    card.card,
    'advanced-camera-card-timeline-core',
  ).find((element) => element.getBoundingClientRect().height > 0);
  assert(core);
  await expect
    .poll(() => core.shadowRoot?.textContent?.includes('Recording coverage checked'))
    .toBe(true);
  await expect
    .poll(() => deepQueryAll(core, '.vis-item.vis-background').length)
    .toBeGreaterThan(0);
  const observations: number[] = [];
  for (let index = 0; index < 20; index++) {
    const button = deepQuery<HTMLButtonElement>(core, 'button[aria-label="Later"]');
    assert(button);
    const view = core.viewManagerEpoch?.manager.getView();
    const previous = view?.context?.timeline?.window?.start.getTime();
    const before = performance.now();
    button.focus();
    expect(core.shadowRoot?.activeElement).toBe(button);
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() =>
        core.viewManagerEpoch?.manager
          .getView()
          ?.context?.timeline?.window?.start.getTime(),
      )
      .not.toBe(previous);
    await expect
      .poll(() => core.shadowRoot?.textContent?.includes('Recording coverage checked'))
      .toBe(true);
    observations.push(performance.now() - before);
  }
  expect(requests.length).toBeLessThanOrEqual(24);
  expect(
    requests.every((request) => request.upper - request.lower <= 26 * 3600000),
  ).toBe(true);
  expect(
    requests.every((request) => request.upper - request.lower < 14 * 24 * 3600000),
  ).toBe(true);
  const p95 = [...observations].sort((a, b) => a - b)[18];
  Object.assign(task.meta, { viewportPerformance: { observations, p95, requests } });
  expect(p95).toBeLessThanOrEqual(2000);
}, 60000);

it('selects actual quiet coverage through a rendered timeline click', async () => {
  const requests: { lower: number; upper: number; elapsed: number }[] = [];
  const card = await mount(undefined, undefined, requests);
  await choose(card, new Date('2026-10-02T12:35:00Z'));
  await waitForSelectedFrame(card);
  const core = deepQueryAll<AdvancedCameraCardTimelineCore>(
    card.card,
    'advanced-camera-card-timeline-core',
  ).find((element) => element.getBoundingClientRect().height > 0);
  assert(core);
  await expect
    .poll(() => deepQueryAll(core, '.vis-item.vis-background').length)
    .toBeGreaterThan(0);
  const coverage = deepQuery<HTMLElement>(core, '.vis-item.vis-background');
  assert(coverage);
  const previousTarget = core.viewManagerEpoch?.manager
    .getView()
    ?.context?.mediaViewer?.seek?.getTime();
  const bounds = coverage.getBoundingClientRect();
  const panel = deepQuery<HTMLElement>(core, '.vis-panel.vis-center');
  assert(panel);
  const visible = panel.getBoundingClientRect();
  await userEvent.click(coverage, {
    force: true,
    position: {
      x: visible.left + visible.width / 4 - bounds.left,
      y: visible.top + visible.height / 2 - bounds.top,
    },
  });
  await expect
    .poll(() =>
      core.viewManagerEpoch?.manager.getView()?.context?.mediaViewer?.seek?.getTime(),
    )
    .not.toBe(previousTarget);
  await expect
    .poll(() => {
      const view = core.viewManagerEpoch?.manager.getView();
      const selected = view?.queryResults?.getSelectedResult();
      const target = view?.context?.mediaViewer?.seek;
      return (
        !!target &&
        !!selected &&
        'includesTime' in selected &&
        typeof selected.includesTime === 'function' &&
        selected.includesTime(target)
      );
    })
    .toBe(true);
  await expect
    .poll(() => getSelectedVideo(card)?.readyState)
    .toBeGreaterThanOrEqual(HTMLMediaElement.HAVE_CURRENT_DATA);
});

it.each(['2026-10-02T12:37:00Z', '2026-10-01T12:00:00Z'])(
  'shows no selected recording in a complete gap at %s',
  async (instant) => {
    const card = await mount();
    const core = await choose(card, new Date(instant));
    await expect
      .poll(() =>
        core.viewManagerEpoch?.manager.getView()?.queryResults?.hasSelectedResult(),
      )
      .toBe(false);
    await expect.poll(() => deepQuery(card.card, 'video')).toBeNull();
    await expect
      .poll(
        () =>
          deepQuery(card.card, 'advanced-camera-card-notification-block')?.shadowRoot
            ?.textContent ?? '',
      )
      .toContain('No recording covers the selected time.');
  },
);

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
