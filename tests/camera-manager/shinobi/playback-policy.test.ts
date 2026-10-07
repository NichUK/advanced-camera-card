import { expect, it } from 'vitest';

import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import {
  preflightShinobiMedia,
  resolveShinobiMedia,
} from '../../../src/camera-manager/shinobi/resolve';

it('supplies original-file transport and continuation policies to the standard viewer', () => {
  const media = new ShinobiRecording(
    'camera',
    'source',
    'id',
    new Date(0),
    new Date(1000),
  );
  expect(media.getRecordingPlaybackOptions()).toEqual({
    resolveMedia: resolveShinobiMedia,
    preflight: preflightShinobiMedia,
    continueAdjacentFiles: true,
    loadTimeoutSeconds: 8,
    stallTimeoutSeconds: 8,
    continuationWindowSeconds: 26 * 3600,
  });
  expect(media.getRecordingPlaybackOptions()).toBe(media.getRecordingPlaybackOptions());
});
