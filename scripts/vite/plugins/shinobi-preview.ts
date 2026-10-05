import type { Plugin } from 'vite';

/** Namespace runtime elements, events and CSS before chunk hashes are computed. */
export const namespaceShinobiPreview = (source: string): string =>
  source
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
});
