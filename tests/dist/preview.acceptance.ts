import { assert, expect, it, vi } from 'vitest';

import type { AdvancedCameraCard } from '../../src/card';
import { deepQuery } from '../browser/dom';
import { FakeHASS } from '../browser/fake-hass';
import { createFixtureURL } from '../browser/fixtures';
import { defineHAElementStubs } from '../browser/ha-element-stubs';
import {
  createGenericCameraHASS,
  createStillImageCardConfig,
} from '../browser/test-utils';
import { loadModule } from './test-utils';

declare global {
  interface HTMLElementTagNameMap {
    'shinobi-camera-card': AdvancedCameraCard;
  }
}

it('loads both isolated builds, renders lazy children and removes preview without disturbing the original', async () => {
  defineHAElementStubs();
  const definitions = vi.spyOn(customElements, 'define');
  await loadModule('/baseline/advanced-camera-card.js');
  const baselineDefinitions = new Map(
    definitions.mock.calls.map(([name, constructor]) => [name, constructor]),
  );
  definitions.mockRestore();
  const originalClass = customElements.get('advanced-camera-card');
  const legacyClass = customElements.get('frigate-card');
  await loadModule('/preview/shinobi-camera-card.js');
  for (const [name, constructor] of baselineDefinitions) {
    expect(customElements.get(name)).toBe(constructor);
  }
  expect(customElements.get('advanced-camera-card')).toBe(originalClass);
  expect(customElements.get('frigate-card')).toBe(legacyClass);
  expect(customElements.get('shinobi-camera-card')).toBeDefined();
  expect(customElements.get('shinobi-preview-legacy-card')).toBeDefined();
  const original = document.createElement('advanced-camera-card');
  const preview = document.createElement('shinobi-camera-card');
  original.style.width = preview.style.width = '640px';
  original.setConfig(createStillImageCardConfig());
  preview.setConfig(createStillImageCardConfig({ type: 'custom:shinobi-camera-card' }));
  original.hass = preview.hass = createGenericCameraHASS().getHASS();
  let originalLoads = 0;
  let previewLoads = 0;
  original.addEventListener('advanced-camera-card:media:loaded', () => originalLoads++);
  original.addEventListener('shinobi-camera-card:media:loaded', () => {
    throw new Error('crossed namespace');
  });
  preview.addEventListener('shinobi-camera-card:media:loaded', () => previewLoads++);
  document.body.append(original, preview);
  try {
    await expect.poll(() => originalLoads).toBeGreaterThan(0);
    await expect.poll(() => previewLoads).toBeGreaterThan(0);
    expect(deepQuery(preview, 'shinobi-camera-card-live')).not.toBeNull();
    expect(deepQuery(original, 'advanced-camera-card-live')).not.toBeNull();
    expect(Reflect.get(window, 'advancedCameraCards')).toContain(original);
    expect(Reflect.get(window, 'shinobiCameraCards')).toContain(preview);
    preview.remove();
    await expect
      .poll(() => Reflect.get(window, 'shinobiCameraCards'))
      .not.toContain(preview);
    expect(Reflect.get(window, 'advancedCameraCards')).toContain(original);
    original.setConfig(createStillImageCardConfig());
    await expect
      .poll(() => deepQuery(original, 'advanced-camera-card-live'))
      .not.toBeNull();
  } finally {
    preview.remove();
    original.remove();
  }
}, 30000);

it('selects historical media and displays an authenticated relay failure in the built preview', async () => {
  defineHAElementStubs();
  await loadModule('/preview/shinobi-camera-card.js');
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
        },
      },
    },
    registry: { 'camera.archive': { platform: 'shinobi_recordings' } },
  });
  let failed = false;
  hass.registerMediaSource(/^media-source:\/\/shinobi_recordings\/clip\|/, () => ({
    url: failed ? '/fixture-missing.mp4' : createFixtureURL('shinobi-4k-h264.mp4'),
    mime_type: 'video/mp4',
  }));
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
  const preview = document.createElement('shinobi-camera-card');
  preview.style.width = '640px';
  preview.setConfig({
    type: 'custom:shinobi-camera-card',
    cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
    view: { default: 'timeline', issues: { retry_seconds: 0 } },
    timeline: { show_recordings: true },
  });
  preview.hass = hass.getHASS();
  document.body.append(preview);
  try {
    await expect
      .poll(() => deepQuery(preview, 'input[type="datetime-local"]'))
      .not.toBeNull();
    const input = deepQuery<HTMLInputElement>(preview, 'input[type="datetime-local"]');
    assert(input);
    input.value = '2026-10-02T14:34:00';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await expect
      .poll(() => deepQuery<HTMLVideoElement>(preview, 'video')?.videoWidth, {
        timeout: 10000,
      })
      .toBe(3840);
    failed = true;
    // Rebuild at the same requested instant, renewing the HA path.
    preview.remove();
    const retry = document.createElement('shinobi-camera-card');
    retry.style.width = '640px';
    retry.setConfig({
      type: 'custom:shinobi-camera-card',
      cameras: [{ camera_entity: 'camera.archive', engine: 'shinobi' }],
      view: { default: 'timeline', issues: { retry_seconds: 0 } },
      timeline: { show_recordings: true },
    });
    retry.hass = hass.getHASS();
    document.body.append(retry);
    try {
      await expect
        .poll(() => deepQuery(retry, 'input[type="datetime-local"]'))
        .not.toBeNull();
      const retryInput = deepQuery<HTMLInputElement>(
        retry,
        'input[type="datetime-local"]',
      );
      assert(retryInput);
      retryInput.value = '2026-10-02T14:34:00';
      retryInput.dispatchEvent(new Event('change', { bubbles: true }));
      await expect
        .poll(
          () =>
            deepQuery(retry, 'shinobi-camera-card-notification-block')?.shadowRoot
              ?.textContent,
          { timeout: 10000 },
        )
        .toContain('expired or deleted');
    } finally {
      retry.remove();
    }
  } finally {
    preview.remove();
  }
}, 30000);
