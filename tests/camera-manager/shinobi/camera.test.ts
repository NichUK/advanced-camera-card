import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { CameraManagerEngine } from '../../../src/camera-manager/engine';
import { ShinobiCamera } from '../../../src/camera-manager/shinobi/camera';
import { createCameraConfig } from '../../config/test-utils';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import {
  createHASS,
  createHASSManager,
  createRegistryEntity,
  createStateEntity,
} from '../../test-utils';

const initialize = (platform: string, attributes: Record<string, unknown>) =>
  new ShinobiCamera(
    createCameraConfig({ camera_entity: 'camera.archive' }),
    mock<CameraManagerEngine>(),
  ).initialize({
    hassManager: createHASSManager({
      hass: createHASS({ 'camera.archive': createStateEntity({ attributes }) }),
    }),
    entityRegistryManager: new EntityRegistryManagerMock([
      createRegistryEntity({ entity_id: 'camera.archive', platform }),
    ]),
  });

describe('Shinobi archive identity', () => {
  it('requires a registered adapter camera', async () => {
    await expect(
      new ShinobiCamera(createCameraConfig(), mock<CameraManagerEngine>()).initialize({
        hassManager: createHASSManager(),
      }),
    ).rejects.toThrow('Could not find camera entity');
  });
  it('never trusts an unrelated integration or a malformed monitor identity', async () => {
    for (const [platform, attributes] of [
      [
        'shinobi',
        { shinobi_recordings_entry: 'preview', shinobi_recordings_monitor: 'garden' },
      ],
      [
        'shinobi_recordings',
        { shinobi_recordings_entry: 'preview', shinobi_recordings_monitor: '../secret' },
      ],
      ['shinobi_recordings', {}],
    ] as const) {
      await expect(initialize(platform, attributes)).rejects.toThrow(
        'Could not initialize Shinobi',
      );
    }
  });
  it('reads only adapter metadata and exposes no live or control capabilities', async () => {
    const camera = await initialize('shinobi_recordings', {
      shinobi_recordings_entry: 'preview',
      shinobi_recordings_monitor: 'garden',
    });
    expect(camera.getArchive()).toEqual({
      shinobi_recordings_entry: 'preview',
      shinobi_recordings_monitor: 'garden',
    });
    for (const capability of [
      'live',
      'substream',
      'trigger',
      'remote-control-entity',
      '2-way-audio',
      'clips',
    ] as const) {
      expect(camera.getCapabilities()?.has(capability)).toBe(false);
    }
    expect(camera.getCapabilities()?.has('menu')).toBe(true);
    expect(camera.getCapabilities()?.has('recordings')).toBe(true);
    expect(camera.getCapabilities()?.has('seek')).toBe(true);
  });
  it('has no archive before initialization', () => {
    expect(
      new ShinobiCamera(createCameraConfig(), mock<CameraManagerEngine>()).getArchive(),
    ).toBeNull();
  });
});
