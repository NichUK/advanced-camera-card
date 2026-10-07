// @vitest-environment jsdom
import { expect, it } from 'vitest';

import {
  recordingPlaybackError,
  RecordingPlaybackError,
  type RecordingFailure,
} from '../../src/view/recording-playback';

it.each<RecordingFailure>([
  'authentication',
  'denied',
  'unavailable',
  'network',
  'metadata',
  'timeout',
  'unsupported',
  'decode',
])('presents a localized %s failure with only safe context', (category) => {
  const error = new RecordingPlaybackError(category, 'playback');
  expect(error.message).not.toContain('recordings.errors.');
  expect(error.context).toEqual({ category, stage: 'playback' });
  expect(error.retryable).toBe(category === 'network' || category === 'timeout');
  expect(recordingPlaybackError(error, 'resolve')).toBe(error);
});

it('redacts unexpected transport errors', () => {
  const error = recordingPlaybackError(new Error('SECRET upstream URL'), 'resolve');
  expect(error.category).toBe('metadata');
  expect(error.context).toEqual({ category: 'metadata', stage: 'resolve' });
  expect(error.message).not.toContain('SECRET');
});
