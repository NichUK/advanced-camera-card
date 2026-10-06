import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Download, Page } from 'playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

import browserConfig from './vitest.browser.config.js';

const captures = new WeakMap<Page, Promise<Download | null>>();
const startDownload: BrowserCommand<[], void> = ({ page }) => {
  captures.set(
    page,
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
  );
};
const finishDownload: BrowserCommand<[], unknown> = async ({ page }) => {
  const download = await captures.get(page);
  captures.delete(page);
  if (!download) {
    throw new Error('Synthetic download not observed');
  }
  try {
    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error('Synthetic download stream unavailable');
    }
    const hash = createHash('sha256');
    let size = 0;
    for await (const item of stream) {
      const chunk: unknown = item;
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('Unexpected download bytes');
      }
      size += chunk.byteLength;
      hash.update(chunk);
    }
    const expected = createHash('sha256')
      .update(readFileSync('tests/browser/fixtures/shinobi-4k-h264.mp4'))
      .digest('hex');
    return {
      filename: download.suggestedFilename(),
      sha256: hash.digest('hex'),
      expected_sha256: expected,
      size,
    };
  } finally {
    // The dedicated suite serves only the checked-in synthetic fixture.
    await download.delete();
  }
};

export default defineConfig({
  ...browserConfig,
  cacheDir: '.vitest/download-cache',
  test: {
    ...browserConfig.test,
    include: ['tests/camera-manager/shinobi/download.acceptance.ts'],
    browser: {
      ...browserConfig.test?.browser,
      commands: { startDownload, finishDownload },
    },
  },
});
