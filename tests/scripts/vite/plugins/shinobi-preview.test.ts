import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import {
  bundledNotices,
  namespaceShinobiPreview,
} from '../../../../scripts/vite/plugins/shinobi-preview';

it('includes packaged licence variants and exact-version offline notices, failing closed on an unrecorded version', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'shinobi-notices-'));
  try {
    const dependency = path.join(root, 'node_modules', 'fixture');
    const notices = path.join(root, 'notices');
    mkdirSync(dependency, { recursive: true });
    mkdirSync(notices);
    writeFileSync(path.join(notices, 'fixture.txt'), 'offline MIT terms');
    writeFileSync(
      path.join(notices, 'provenance.json'),
      JSON.stringify([
        {
          package: 'fixture',
          version: '1.0.0',
          file: 'fixture.txt',
          source: 'https://example.invalid/pinned/LICENSE',
        },
      ]),
    );
    const module = path.join(dependency, 'index.js').replaceAll('\\', '/');
    const manifest = path.join(dependency, 'package.json');
    const nested = path.join(dependency, 'internal');
    mkdirSync(nested);
    writeFileSync(
      path.join(nested, 'package.json'),
      JSON.stringify({ name: 'fixture/internal', version: '1.0.0' }),
    );
    const nestedModule = path.join(nested, 'index.js').replaceAll('\\', '/');
    writeFileSync(manifest, JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    expect(bundledNotices([module, module], notices)).toContain('fixture@1.0.0');
    expect(bundledNotices([module], notices)).toContain('offline MIT terms');
    expect(bundledNotices([nestedModule], notices)).toContain('fixture@1.0.0');
    writeFileSync(manifest, JSON.stringify({ name: 'fixture', version: '2.0.0' }));
    expect(() => bundledNotices([module], notices)).toThrow(
      'unavailable: fixture@2.0.0',
    );
    writeFileSync(path.join(dependency, 'LICENSE-MIT'), 'packaged MIT terms');
    writeFileSync(path.join(dependency, 'MIT-License.txt'), 'alternate MIT notice');
    const result = bundledNotices([module], notices);
    expect(result).toContain('packaged MIT terms');
    expect(result).toContain('alternate MIT notice');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('cannot identify or delete the baseline legacy dashboard resource', () => {
  expect(namespaceShinobiPreview('frigate-hass-card.js')).toBe(
    'shinobi-preview-legacy-card.js',
  );
});

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
