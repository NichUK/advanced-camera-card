import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/scripts/vite/preview-build.acceptance.ts'] },
});
