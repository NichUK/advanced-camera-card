import type { MessageBase } from 'home-assistant-js-websocket';
import { assert, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

import '../../src/components/timeline';

import type { AdvancedCameraCardTimelineCore } from '../../src/components/timeline-core';
import type { AdvancedCameraCardViewerProvider } from '../../src/components/viewer/provider';
import { deepQuery, deepQueryAll } from '../browser/dom';
import { FakeHASS } from '../browser/fake-hass';
import { MountedCardFactory } from '../browser/mounted-card';
import {
  getBlockNotificationText,
  RESIZE_LOOP_CONSOLE_ERROR,
} from '../browser/test-utils';

const bootstrapSchema = z.object({
  tokens: z.object({ operator: z.string(), viewer: z.string(), denied: z.string() }),
  attributes: z.record(z.string(), z.unknown()),
  timezone: z.string(),
  content_id: z.string(),
  window_id: z.string(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  base_url: z.url().optional(),
});
let bootstrap: z.infer<typeof bootstrapSchema>;
declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  interface ImportMetaEnv {
    readonly SHINOBI_EXPECT_UNSUPPORTED: boolean;
  }
}
beforeAll(async () => {
  bootstrap = bootstrapSchema.parse(await (await fetch('/acceptance/bootstrap')).json());
});

/** Real HA auth and command boundary; only entity/registry presentation is stubbed. */
const command = (token: string, message: MessageBase): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const url = new URL('/api/websocket', bootstrap.base_url ?? window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => finish(false, { code: 'upstream_timeout' }), 8000);
    const finish = (success: boolean, value: unknown): void => {
      clearTimeout(timeout);
      socket.close();
      if (success) {
        resolve(value);
      } else {
        reject(value);
      }
    };
    socket.onerror = () => finish(false, { code: 'upstream_unavailable' });
    socket.onmessage = (event: MessageEvent<string>) => {
      const response = z
        .object({
          type: z.string(),
          success: z.boolean().optional(),
          result: z.unknown().optional(),
          error: z.unknown().optional(),
        })
        .parse(JSON.parse(event.data) as unknown);
      if (response.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (response.type === 'auth_ok') {
        socket.send(JSON.stringify({ ...message, id: 1 }));
      } else if (response.type === 'auth_invalid') {
        finish(false, { code: 'authentication_failed' });
      } else if (response.type === 'result') {
        finish(
          response.success === true,
          response.success ? response.result : response.error,
        );
      }
    };
  });

const resolvedSchema = z.object({ url: z.string(), mime_type: z.string() });
const mediaURL = (path: string): string =>
  new URL(path, bootstrap.base_url ?? window.location.href).href;

const mount = async (offsetSeconds = 5, metadataObservations: number[] = []) => {
  const hass = new FakeHASS({
    entities: {
      'camera.archive': { state: 'idle', attributes: bootstrap.attributes },
    },
    registry: { 'camera.archive': { platform: 'shinobi_recordings' } },
  });
  hass.getHASS().hassUrl = (path) => mediaURL(path ?? '/');
  for (const type of ['media_source/browse_media', 'media_source/resolve_media']) {
    hass.registerCommand(type, async (message) => {
      const began = performance.now();
      const result = await command(bootstrap.tokens.viewer, message);
      if (type === 'media_source/browse_media') {
        const parts = String(message.media_content_id).split('|');
        const selected = Math.floor((new Date(bootstrap.start).getTime() + 5000) / 1000);
        if (Number(parts[3]) <= selected && selected < Number(parts[4])) {
          metadataObservations.push(performance.now() - began);
        }
      }
      return result;
    });
  }
  const card = await MountedCardFactory.createFromSource(
    {
      type: 'custom:advanced-camera-card',
      cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
      view: { default: 'timeline', issues: { retry_seconds: 0 } },
      timeline: { show_recordings: true },
      media_viewer: {
        controls: { timeline: { mode: 'below', show_recordings: true } },
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
  const selected = new Date(
    Math.floor((new Date(bootstrap.start).getTime() + offsetSeconds * 1000) / 1000) *
      1000,
  );
  expect(selected.getTime()).toBeLessThan(new Date(bootstrap.end).getTime());
  const offset = (selected.getTime() - new Date(bootstrap.start).getTime()) / 1000;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: bootstrap.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(selected);
  const began = performance.now();
  input.value = parts.replace(' ', 'T');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { card, offset, began };
};

it('denies logged-out and restricted access at the actual HA boundaries', async () => {
  const message = {
    type: 'media_source/browse_media',
    media_content_id: bootstrap.window_id,
  };
  await expect(command('expired-token', message)).rejects.toMatchObject({
    code: 'authentication_failed',
  });
  await expect(command(bootstrap.tokens.denied, message)).rejects.toMatchObject({
    code: 'browse_media_failed',
    message: 'monitor_not_authorized',
  });
  const resolved = resolvedSchema.parse(
    await command(bootstrap.tokens.operator, {
      type: 'media_source/resolve_media',
      media_content_id: bootstrap.content_id,
    }),
  );
  expect(resolved.url).toMatch(/^\/api\/shinobi_recordings\//);
  expect(resolved.url).not.toContain('/videos/');
  const plainPath = resolved.url.split('?')[0];
  assert(plainPath);
  expect((await fetch(mediaURL(plainPath))).status).toBe(401);
  expect(
    (
      await fetch(mediaURL(plainPath), {
        headers: { Authorization: `Bearer ${bootstrap.tokens.denied}` },
      })
    ).status,
  ).toBe(403);
  const range = await fetch(mediaURL(resolved.url), {
    headers: { Range: 'bytes=0-1023' },
  });
  expect(range.status).toBe(206);
  expect((await range.arrayBuffer()).byteLength).toBe(1024);
  const viewerResolved = resolvedSchema.parse(
    await command(bootstrap.tokens.viewer, {
      type: 'media_source/resolve_media',
      media_content_id: bootstrap.content_id,
    }),
  );
  const preflight = await fetch(mediaURL(viewerResolved.url), {
    headers: { Range: 'bytes=0-0' },
  });
  expect(preflight.status).toBe(206);
  expect((await preflight.arrayBuffer()).byteLength).toBe(1);
});

it.skipIf(import.meta.env.SHINOBI_EXPECT_UNSUPPORTED)(
  'continues original Clear across a natural file boundary or exposes a real gap',
  async ({ task }) => {
    const observations: {
      gap: boolean;
      milliseconds: number;
      width: number;
      height: number;
    }[] = [];
    for (let iteration = 0; iteration < 20; iteration++) {
      const { card } = await mount();
      const selected = () =>
        deepQueryAll<AdvancedCameraCardViewerProvider>(
          card.card,
          'advanced-camera-card-viewer-provider',
        ).find((provider) => provider.forceSelected);
      const selectedVideo = () => {
        const provider = selected();
        return provider ? deepQuery<HTMLVideoElement>(provider, 'video') : null;
      };
      await expect
        .poll(() => selectedVideo()?.videoWidth, { timeout: 10000 })
        .toBe(3840);
      const video = selectedVideo();
      assert(video);
      const initial = selected()?.media?.getID();
      assert(initial);
      video.pause();
      video.currentTime = video.duration - 0.2;
      await expect
        .poll(() => !video.seeking && video.readyState >= 2, { timeout: 5000 })
        .toBe(true);
      let ended = 0;
      video.addEventListener(
        'ended',
        () => {
          ended = performance.now();
        },
        { once: true },
      );
      await video.play();
      await expect.poll(() => video.ended, { timeout: 5000 }).toBe(true);
      const gapButton = () =>
        deepQueryAll<HTMLButtonElement>(card.card, 'button').find((button) =>
          button.textContent?.includes('Continue at next recording'),
        );
      await expect
        .poll(() => selected()?.media?.getID() !== initial || Boolean(gapButton()), {
          timeout: 10000,
        })
        .toBe(true);
      const gap = Boolean(gapButton());
      if (gap) {
        gapButton()?.click();
      }
      await expect
        .poll(
          () => {
            const next = selectedVideo();
            return (
              selected()?.media?.getID() !== initial &&
              next?.videoWidth === 3840 &&
              next.readyState >= 2 &&
              !next.paused
            );
          },
          { timeout: 10000 },
        )
        .toBe(true);
      observations.push({
        gap,
        milliseconds: performance.now() - ended,
        width: selectedVideo()?.videoWidth ?? 0,
        height: selectedVideo()?.videoHeight ?? 0,
      });
      Object.assign(task.meta, {
        originalBoundaryPerformance: {
          observations,
          browser: navigator.userAgent,
        },
      });
      card.destroy();
    }
    const adjacent = observations
      .filter((row) => !row.gap)
      .map((row) => row.milliseconds)
      .sort((a, b) => a - b);
    if (adjacent.length) {
      expect(adjacent[Math.ceil(adjacent.length * 0.95) - 1]).toBeLessThanOrEqual(2000);
    }
  },
  180000,
);

it.skipIf(import.meta.env.SHINOBI_EXPECT_UNSUPPORTED)(
  'measures twenty original Clear selections through real HA and native decoding',
  async ({ task }) => {
    const observations: {
      milliseconds: number;
      offsetError: number;
      seekMilliseconds: number;
      seekError: number;
      width: number;
      height: number;
    }[] = [];
    const metadataObservations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration++) {
      const { card, offset, began } = await mount(
        5 + (iteration % 10),
        metadataObservations,
      );
      await expect
        .poll(
          () => {
            const video = deepQuery<HTMLVideoElement>(card.card, 'video');
            const state = {
              ready: Boolean(
                video &&
                  video.readyState >= 2 &&
                  video.videoWidth > 0 &&
                  !video.seeking &&
                  Math.abs(video.currentTime - offset) <= 1,
              ),
              failure: getBlockNotificationText(card.card),
              mediaError: video?.error?.code ?? null,
              width: video?.videoWidth ?? null,
              readyState: video?.readyState ?? null,
              time: video?.currentTime ?? null,
              expectedOffset: offset,
            };
            Object.assign(task.meta, { clearDiagnostics: state });
            return state;
          },
          { timeout: 10000 },
        )
        .toMatchObject({ ready: true });
      const video = deepQuery<HTMLVideoElement>(card.card, 'video');
      assert(video);
      const firstFrameMilliseconds = performance.now() - began;
      const firstOffsetError = Math.abs(video.currentTime - offset);
      const soughtOffset = Math.min(10 + (iteration % 10), video.duration - 1);
      const seekBegan = performance.now();
      video.pause();
      video.currentTime = soughtOffset;
      await expect
        .poll(
          () => {
            const state = {
              seeking: video.seeking,
              readyState: video.readyState,
              time: video.currentTime,
              duration: video.duration,
              error: video.error?.code ?? null,
              expected: soughtOffset,
              paused: video.paused,
            };
            Object.assign(task.meta, { clearSeekDiagnostics: state });
            return (
              !video.seeking &&
              video.readyState >= 2 &&
              Math.abs(video.currentTime - soughtOffset) <= 1
            );
          },
          { timeout: 5000 },
        )
        .toBe(true);
      const row = {
        milliseconds: firstFrameMilliseconds,
        offsetError: firstOffsetError,
        seekMilliseconds: performance.now() - seekBegan,
        seekError: Math.abs(video.currentTime - soughtOffset),
        width: video.videoWidth,
        height: video.videoHeight,
      };
      observations.push(row);
      // Only allowlisted measurements are attached; never URLs or screenshots.
      Object.assign(task.meta, {
        clearPerformance: {
          observations,
          metadataObservations,
          browser: navigator.userAgent,
          route: 'Windows browser to isolated HA over SSH/Tailscale, NVR LAN leg',
        },
      });
      expect(row.width).toBe(3840);
      expect(row.height).toBe(2160);
      expect(row.offsetError).toBeLessThanOrEqual(1);
      expect(row.seekError).toBeLessThanOrEqual(1);
      expect(row.milliseconds).toBeLessThanOrEqual(5000);
      card.destroy();
    }
  },
  180000,
);

it.runIf(import.meta.env.SHINOBI_EXPECT_UNSUPPORTED)(
  'reports original Clear as unsupported within ten seconds on the named browser',
  async ({ task }) => {
    const observations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration++) {
      const { card, began } = await mount(5 + (iteration % 10));
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
      const milliseconds = performance.now() - began;
      expect(milliseconds).toBeLessThanOrEqual(10000);
      observations.push(milliseconds);
      Object.assign(task.meta, {
        originalUnsupported: { observations, browser: navigator.userAgent },
      });
      card.destroy();
    }
  },
  180000,
);
