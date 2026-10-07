import { expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { Camera } from '../../src/camera-manager/camera';
import type { CameraManagerEngine } from '../../src/camera-manager/engine';
import { getRecordingQueryPolicy } from '../../src/camera-manager/recording-policy';

it('preserves the default policy for absent or legacy cameras', () => {
  expect(getRecordingQueryPolicy()).toBeNull();
  expect(getRecordingQueryPolicy(null)).toBeNull();
  const camera = mock<Camera>();
  const engine = mock<CameraManagerEngine>();
  camera.getEngine.mockReturnValue(engine);
  engine.getRecordingQueryPolicy.mockReturnValue(null);
  expect(getRecordingQueryPolicy(camera)).toBeNull();
  engine.getRecordingQueryPolicy.mockReturnValue({
    maxWindowSeconds: 1800,
    timelineWindowMaxSeconds: 900,
    segmentGapToleranceSeconds: 0,
    selectDate: true,
    exactTimeSelection: true,
    timeZone: 'Europe/Paris',
  });
  expect(getRecordingQueryPolicy(camera)).toMatchObject({ maxWindowSeconds: 1800 });
  expect(engine.getRecordingQueryPolicy).toHaveBeenCalledWith(camera);
});
