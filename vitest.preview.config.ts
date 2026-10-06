import { readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

import distConfig from './vitest.dist.config.js';

export default defineConfig({
  ...distConfig,
  cacheDir: '.vitest/preview-cache',
  publicDir: 'tests/browser/public',
  plugins: [
    {
      name: 'serve-isolated-builds',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = /^\/(baseline|preview)\/([A-Za-z0-9_-]+\.js)(?:\?.*)?$/.exec(
            request.url ?? '',
          );
          if (!match) {
            next();
            return;
          }
          const directory = match[1] === 'baseline' ? 'dist' : 'dist-preview';
          try {
            const source = readFileSync(path.resolve(directory, match[2]));
            response.setHeader('Content-Type', 'text/javascript');
            response.end(source);
          } catch {
            response.statusCode = 404;
            response.end('Build artifact unavailable');
          }
        });
      },
    },
  ],
  test: { ...distConfig.test, include: ['tests/dist/preview.acceptance.ts'] },
});
