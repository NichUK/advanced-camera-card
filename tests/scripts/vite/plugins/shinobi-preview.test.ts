import { expect, it } from 'vitest';

import { namespaceShinobiPreview } from '../../../../scripts/vite/plugins/shinobi-preview';

it('namespaces runtime tags, attributes, CSS, events, legacy aliases and debug arrays', () => {
  expect(
    namespaceShinobiPreview(
      `<advanced-camera-card-video-player @advanced-camera-card:issue:trigger="x"></advanced-camera-card-video-player> custom:advanced-camera-card advanced-camera-card{} frigate-card window.advancedCameraCards --advanced-camera-card-background`,
    ),
  ).toBe(
    `<shinobi-camera-card-video-player @shinobi-camera-card:issue:trigger="x"></shinobi-camera-card-video-player> custom:shinobi-camera-card shinobi-camera-card{} shinobi-preview-legacy-card window.shinobiCameraCards --shinobi-camera-card-background`,
  );
});

it('preserves repository and file paths so upstream attribution still resolves', () => {
  expect(
    namespaceShinobiPreview(
      'https://github.com/dermotduffy/advanced-camera-card /advanced-camera-card/docs my-advanced-camera-card.js',
    ),
  ).toBe(
    'https://github.com/dermotduffy/advanced-camera-card /advanced-camera-card/docs my-advanced-camera-card.js',
  );
});

it('namespaces the action handler whose card prefix follows its role', () => {
  expect(namespaceShinobiPreview('action-handler-advanced-camera-card')).toBe(
    'action-handler-shinobi-camera-card',
  );
});

it('isolates the bundled drawer dependency as well as its CSS variables', () => {
  expect(
    namespaceShinobiPreview('<side-drawer></side-drawer> --side-drawer-backdrop-filter'),
  ).toBe(
    '<shinobi-preview-side-drawer></shinobi-preview-side-drawer> --shinobi-preview-side-drawer-backdrop-filter',
  );
});

it('isolates the bundled focus trap', () => {
  expect(namespaceShinobiPreview('<focus-trap></focus-trap>')).toBe(
    '<shinobi-preview-focus-trap></shinobi-preview-focus-trap>',
  );
});
