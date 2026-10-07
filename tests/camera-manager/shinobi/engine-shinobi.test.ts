import { expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { Camera } from '../../../src/camera-manager/camera';
import { ShinobiCamera } from '../../../src/camera-manager/shinobi/camera';
import { ShinobiCameraManagerEngine } from '../../../src/camera-manager/shinobi/engine-shinobi';
import { CameraManagerRequestCache, Engine } from '../../../src/camera-manager/types';
import { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import type { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { createCameraConfig } from '../../config/test-utils';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import {
  createHASS,
  createHASSManager,
  createRegistryEntity,
  createStateEntity,
} from '../../test-utils';

it('initializes an archive camera and advertises only implemented media actions', async () => {
  const engine = new ShinobiCameraManagerEngine(
    new EntityRegistryManagerMock([
      createRegistryEntity({
        entity_id: 'camera.archive',
        platform: 'shinobi_recordings',
      }),
    ]),
    createHASSManager({
      hass: createHASS({
        'camera.archive': createStateEntity({
          attributes: {
            shinobi_recordings_entry: 'preview',
            shinobi_recordings_monitor: 'garden',
          },
        }),
      }),
    }),
    new BrowseMediaWalker(),
    mock<ResolvedMediaCache>(),
    new CameraManagerRequestCache(),
  );
  expect(engine.getEngineType()).toBe(Engine.Shinobi);
  const camera = await engine.createCamera(
    createCameraConfig({ camera_entity: 'camera.archive' }),
  );
  expect(camera).toBeInstanceOf(ShinobiCamera);
  expect(engine.getRecordingQueryPolicy(camera)).toEqual({
    maxWindowSeconds: 26 * 3600,
    timelineWindowMaxSeconds: 24 * 3600,
    segmentGapToleranceSeconds: 0,
    selectDate: true,
    exactTimeSelection: true,
    timeZone: undefined,
  });
  expect(
    engine.getRecordingQueryPolicy(new Camera(createCameraConfig(), engine)),
  ).toBeNull();
  const metadata = camera.getArchive();
  expect(metadata).toBeTruthy();
  expect(engine.getMediaCapabilities()).toEqual({
    canFavorite: false,
    canDownload: false,
  });
});
