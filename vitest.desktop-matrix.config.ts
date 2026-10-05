import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { z } from 'zod';

import browserConfig from './vitest.browser.config.js';

const channel = z
  .enum(['msedge', 'chrome'])
  .parse(process.env.SHINOBI_ACCEPTANCE_CHANNEL);

export default defineConfig({
  ...browserConfig,
  test: {
    ...browserConfig.test,
    browser: {
      ...browserConfig.test?.browser,
      provider: playwright({ launchOptions: { channel } }),
    },
  },
});
