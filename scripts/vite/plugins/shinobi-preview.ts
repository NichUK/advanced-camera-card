import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

import { BUILD_DATE_PLACEHOLDER } from './build-date.js';

export const bundledNotices = (
  modules: string[],
  noticeRoot = path.resolve('scripts/vite/notices'),
): string => {
  const provenance: unknown = JSON.parse(
    readFileSync(path.join(noticeRoot, 'provenance.json'), 'utf8'),
  );
  if (!Array.isArray(provenance)) {
    throw new Error('Bundled licence provenance must be an array');
  }
  const notices = new Map<string, string>();
  for (const module of modules) {
    if (!module.includes('node_modules/')) {
      continue;
    }
    const packageParts = module
      .slice(module.lastIndexOf('node_modules/') + 13)
      .split('/');
    const packageName = packageParts[0].startsWith('@')
      ? packageParts.slice(0, 2).join('/')
      : packageParts[0];
    let resolved = false;
    let directory = path.dirname(module.split('?')[0]);
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) {
        const document: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
        if (
          typeof document === 'object' &&
          document !== null &&
          'name' in document &&
          document.name === packageName &&
          'version' in document &&
          typeof document.version === 'string'
        ) {
          resolved = true;
          const name = `${document.name}@${document.version}`;
          if (!notices.has(name)) {
            const files = readdirSync(directory)
              .filter((file) =>
                /^(?:.*-)?(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file),
              )
              .sort();
            if (!files.length) {
              const record: unknown = provenance.find(
                (entry: unknown) =>
                  typeof entry === 'object' &&
                  entry !== null &&
                  'package' in entry &&
                  entry.package === document.name &&
                  'version' in entry &&
                  entry.version === document.version,
              );
              if (
                typeof record !== 'object' ||
                record === null ||
                !('file' in record) ||
                typeof record.file !== 'string' ||
                path.basename(record.file) !== record.file ||
                !('source' in record) ||
                typeof record.source !== 'string' ||
                !record.source.startsWith('https://') ||
                !('sha256' in record) ||
                typeof record.sha256 !== 'string'
              ) {
                throw new Error(`Bundled licence notice unavailable: ${name}`);
              }
              const content = readFileSync(path.join(noticeRoot, record.file));
              if (createHash('sha256').update(content).digest('hex') !== record.sha256) {
                throw new Error(`Bundled licence notice changed: ${name}`);
              }
              notices.set(name, `Source: ${record.source}\n${content.toString('utf8')}`);
              break;
            }
            notices.set(
              name,
              files
                .map((file) => readFileSync(path.join(directory, file), 'utf8'))
                .join('\n'),
            );
          }
          break;
        }
      }
      directory = path.dirname(directory);
    }
    if (!resolved) {
      throw new Error(`Bundled dependency manifest unavailable: ${packageName}`);
    }
  }
  return [...notices]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, notice]) => `===== ${name} =====\n${notice}\n`)
    .join('\n');
};

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

export const shinobiPreview = (): Plugin => {
  const commitDate = execFileSync('git', ['log', '-1', '--format=%cI'], {
    encoding: 'utf8',
  }).trim();
  return {
    name: 'shinobi-preview-namespace',
    renderChunk(code) {
      return {
        code: namespaceShinobiPreview(code).replaceAll(
          BUILD_DATE_PLACEHOLDER,
          new Date(commitDate).toISOString(),
        ),
        map: null,
      };
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
        const modules = Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? Object.keys(output.modules) : [],
        );
        const notices = bundledNotices(modules);
        files['THIRD-PARTY-NOTICES.txt'] = createHash('sha256')
          .update(notices)
          .digest('hex');
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD-PARTY-NOTICES.txt',
          source: notices,
        });
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
  };
};
