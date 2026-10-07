import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, it } from 'vitest';

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith('.ts')
        ? [path]
        : [];
  });

it('keeps backend dependencies inside the engine and its registration points', () => {
  const registration = new Set([
    'camera-manager/engine-factory.ts',
    'camera-manager/types.ts',
    'config/schema/cameras.ts',
    'components-lib/editor/schema/cameras.ts',
  ]);
  const coupled = sourceFiles('src').filter((path) => {
    const name = relative('src', path).replaceAll('\\', '/');
    return (
      !name.startsWith('camera-manager/shinobi/') &&
      !registration.has(name) &&
      /shinobi/i.test(readFileSync(path, 'utf8'))
    );
  });
  expect(coupled).toEqual([]);
});
