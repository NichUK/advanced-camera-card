import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { expect, it } from 'vitest';
import { z } from 'zod';

import { BUILD_DATE_PLACEHOLDER } from '../../../scripts/vite/plugins/build-date.js';

it('attributes and hashes the actual generated preview bytes and commit build date', () => {
  const marker = z
    .object({
      schema_version: z.literal(1),
      card_revision: z.string(),
      node: z.string(),
      files: z.record(z.string(), z.string()),
    })
    .parse(JSON.parse(readFileSync('dist-preview/shinobi-build.json', 'utf8')));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const date = new Date(
    execFileSync('git', ['log', '-1', '--format=%cI'], { encoding: 'utf8' }).trim(),
  ).toISOString();
  expect(marker.card_revision).toBe(revision);
  expect(marker.node).toBe('v22.14.0');
  const files = readdirSync('dist-preview').filter(
    (name) => name.endsWith('.js') || name === 'THIRD-PARTY-NOTICES.txt',
  );
  expect(Object.keys(marker.files).sort()).toEqual(files.sort());
  for (const name of files) {
    expect(marker.files[name]).toBe(
      createHash('sha256')
        .update(readFileSync(`dist-preview/${name}`))
        .digest('hex'),
    );
  }
  const javascript = files
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(`dist-preview/${name}`, 'utf8'))
    .join('\n');
  expect(javascript).toContain(date);
  expect(javascript).not.toContain(BUILD_DATE_PLACEHOLDER);
  expect(readFileSync('dist-preview/THIRD-PARTY-NOTICES.txt', 'utf8')).toContain(
    'Permission is hereby granted',
  );
});
