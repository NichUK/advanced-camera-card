import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

/** Real HTTP faults: service-worker synthetic Range responses vary by browser. */
export const shinobiHTTPMedia = (): Plugin => {
  const counts = new Map<string, number>();
  const released = new Set<string>();
  const fixture = readFileSync(
    path.resolve('tests/browser/fixtures/shinobi-4k-h264.mp4'),
  );
  return {
    name: 'synthetic-shinobi-http-media',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
        if (
          !['/shinobi-test-media', '/shinobi-test-media-count'].includes(url.pathname)
        ) {
          next();
          return;
        }
        response.setHeader('Cache-Control', 'no-store');
        const token = url.searchParams.get('token');
        if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
          response.statusCode = 400;
          response.end();
          return;
        }
        if (url.pathname === '/shinobi-test-media-count') {
          if (request.method === 'POST' && counts.has(token)) {
            released.add(token);
          }
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ count: counts.get(token) ?? 0 }));
          return;
        }
        const statuses = (url.searchParams.get('responses') ?? '')
          .split(',')
          .map(Number);
        if (
          !statuses.length ||
          statuses.length > 8 ||
          statuses.some((status) => ![200, 401, 403, 404, 503].includes(status))
        ) {
          response.statusCode = 400;
          response.end();
          return;
        }
        const count = counts.get(token) ?? 0;
        counts.set(token, count + 1);
        if (counts.size > 512) {
          const oldest = counts.keys().next().value;
          if (oldest) {
            counts.delete(oldest);
            released.delete(oldest);
          }
        }
        const status = released.has(token)
          ? 200
          : statuses[Math.min(count, statuses.length - 1)];
        if (status !== 200) {
          response.statusCode = status;
          response.end();
          return;
        }
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end =
          range && range[2]
            ? Math.min(Number(range[2]), fixture.length - 1)
            : fixture.length - 1;
        if (!Number.isSafeInteger(start) || start > end || start < 0) {
          response.statusCode = 416;
          response.setHeader('Content-Range', `bytes */${fixture.length}`);
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'video/mp4');
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Length', end - start + 1);
        if (range) {
          response.statusCode = 206;
          response.setHeader('Content-Range', `bytes ${start}-${end}/${fixture.length}`);
        }
        response.end(
          request.method === 'HEAD' ? undefined : fixture.subarray(start, end + 1),
        );
      });
    },
  };
};
