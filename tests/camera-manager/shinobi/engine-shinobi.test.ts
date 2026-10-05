import { expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

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
  expect(
    await engine.createCamera(createCameraConfig({ camera_entity: 'camera.archive' })),
  ).toBeInstanceOf(ShinobiCamera);
  expect(engine.getMediaCapabilities()).toEqual({
    canFavorite: false,
    canDownload: false,
  });
});
