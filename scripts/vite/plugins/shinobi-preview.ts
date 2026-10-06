import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { Plugin } from 'vite';

/** Namespace runtime elements, events and CSS before chunk hashes are computed. */
export const namespaceShinobiPreview = (source: string): string =>
  source
    .replace(/\bfrigate-hass-card\.js\b/g, 'shinobi-preview-legacy-card.js')
    .replace(
      /(?<![A-Za-z0-9_/-])advanced-camera-card|(?<=<\/)advanced-camera-card|(?<=--)advanced-camera-card|(?<=action-handler-)advanced-camera-card/g,
      'shinobi-camera-card',
    )
    .replace(
      /(?<![A-Za-z0-9_/-])frigate-card|(?<=<\/)frigate-card|(?<=--)frigate-card/g,
      'shinobi-preview-legacy-card',
    )
    .replace(/\b(side-drawer|focus-trap|web-dialog)\b/g, 'shinobi-preview-$1')
    .replace(/\badvancedCameraCards\b/g, 'shinobiCameraCards');

export const shinobiPreview = (): Plugin => ({
  name: 'shinobi-preview-namespace',
  renderChunk(code) {
    return { code: namespaceShinobiPreview(code), map: null };
  },
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const git = (...args: string[]): string =>
        execFileSync('git', args, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      if (
        git(
          'status',
          '--porcelain',
          '--untracked-files=all',
          '--',
          'src',
          'scripts',
          'public',
          'package.json',
          'yarn.lock',
          'vite.config.ts',
          '.yarnrc.yml',
        )
      ) {
        this.error('Preview build inputs must be committed before packaging.');
      }
      const files: Record<string, string> = {};
      for (const [name, output] of Object.entries(bundle)) {
        if (name.endsWith('.js')) {
          files[name] = createHash('sha256')
            .update(output.type === 'chunk' ? output.code : output.source)
            .digest('hex');
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'shinobi-build.json',
        source:
          JSON.stringify(
            {
              schema_version: 1,
              card_revision: git('rev-parse', 'HEAD'),
              node: process.version,
              files,
            },
            null,
            2,
          ) + '\n',
      });
    },
  },
});
