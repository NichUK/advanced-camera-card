import { readFileSync } from 'node:fs';
import { Agent } from 'node:https';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { z } from 'zod';

import browserConfig from './vitest.browser.config.js';

const path = process.env.SHINOBI_ACCEPTANCE_CONFIG;
if (!path) {
  throw new Error(
    'Set SHINOBI_ACCEPTANCE_CONFIG to the private ephemeral bootstrap file',
  );
}
const bootstrap = JSON.parse(readFileSync(path, 'utf8')) as unknown;
const channel = z
  .enum(['msedge', 'chrome'])
  .optional()
  .parse(process.env.SHINOBI_ACCEPTANCE_CHANNEL);
const port = z
  .object({ port: z.number().int().min(1024).max(65535) })
  .parse(bootstrap).port;
const transport = z
  .object({
    base_url: z.url().optional(),
    certificate: z.string().nullable().optional(),
    spki: z.string().nullable().optional(),
  })
  .parse(bootstrap);

export default defineConfig({
  ...browserConfig,
  define: {
    ...browserConfig.define,
    'import.meta.env.SHINOBI_EXPECT_UNSUPPORTED': JSON.stringify(
      process.env.SHINOBI_ACCEPTANCE_EXPECT_UNSUPPORTED === '1',
    ),
  },
  plugins: [
    ...(browserConfig.plugins ?? []),
    {
      name: 'private-acceptance-bootstrap',
      configureServer(server) {
        server.middlewares.use('/acceptance/bootstrap', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify(bootstrap));
        });
      },
    },
  ],
  server: {
    ...browserConfig.server,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: transport.base_url ?? `http://127.0.0.1:${port}`,
        ws: true,
        ...(transport.certificate && {
          agent: new Agent({ ca: transport.certificate }),
        }),
      },
    },
  },
  test: {
    ...browserConfig.test,
    include: ['tests/acceptance/*.acceptance.ts'],
    browser: {
      ...browserConfig.test?.browser,
      instances: [{ browser: 'chromium' }],
      provider: playwright({
        launchOptions: {
          channel,
          args: transport.spki
            ? [`--ignore-certificate-errors-spki-list=${transport.spki}`]
            : [],
        },
      }),
      api: { host: '127.0.0.1', port: 19712, strictPort: true },
      headless: process.env.SHINOBI_ACCEPTANCE_HEADLESS !== '0',
      screenshotFailures: false,
    },
  },
});
