import { expect, it } from 'vitest';

import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import { getViewerMediaIndex } from '../../../src/components-lib/viewer/selection';
import { ViewMedia, ViewMediaType } from '../../../src/view/item';

it('leaves a completed archive gap empty while retaining legacy viewer selection', () => {
  const clip = new ShinobiRecording(
    'camera',
    'content',
    'id',
    new Date(0),
    new Date(60000),
  );
  const legacy = new ViewMedia(ViewMediaType.Clip);
  expect(getViewerMediaIndex(null, null)).toBeNull();
  expect(getViewerMediaIndex([], null)).toBeNull();
  expect(getViewerMediaIndex([clip], clip)).toBe(0);
  expect(getViewerMediaIndex([clip], null)).toBeNull();
  expect(getViewerMediaIndex([clip], legacy)).toBeNull();
  expect(getViewerMediaIndex([legacy], null)).toBe(0);
  expect(getViewerMediaIndex([clip, legacy], null)).toBe(1);
});
