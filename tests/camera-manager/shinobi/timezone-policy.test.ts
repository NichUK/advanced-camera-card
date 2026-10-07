// @vitest-environment jsdom
import type { LitElement } from 'lit';
import { expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { Camera } from '../../../src/camera-manager/camera';
import type { CameraManagerEngine } from '../../../src/camera-manager/engine';
import { ShinobiCamera } from '../../../src/camera-manager/shinobi/camera';
import { archiveIdentitySchema } from '../../../src/camera-manager/shinobi/types';
import { CameraManagerStore } from '../../../src/camera-manager/store';
import type { ViewManagerInterface } from '../../../src/card-controller/view/types';
import { TimelineController } from '../../../src/components-lib/timeline/controller';
import { UnifiedQuery } from '../../../src/view/unified-query';
import { createCameraConfig } from '../../config/test-utils';
import { createHASS, stubMatchMedia } from '../../test-utils';
import { createRecordingQuery, createView } from '../../view/test-utils';
import { createCameraManager } from '../test-utils';

it.each([
  { zones: [], expected: null },
  { zones: [undefined], expected: 'Europe/London' },
  { zones: [undefined, 'Europe/Paris'], expected: 'Europe/London' },
  { zones: ['Europe/Paris', 'Europe/Paris'], expected: 'Europe/Paris' },
  { zones: ['Europe/Paris', 'America/New_York'], expected: 'Europe/London' },
  { zones: ['generic'], expected: null },
  { zones: ['Europe/Paris', 'generic'], expected: null },
  { zones: ['missing'], expected: null },
])(
  'selects the observable recording-input zone for $zones',
  async ({ zones, expected }) => {
    stubMatchMedia().mockReturnValue({ matches: true });
    const store = new CameraManagerStore();
    const cameraIDs = new Set<string>();
    for (const [index, zone] of zones.entries()) {
      const id = `camera-${index}`;
      cameraIDs.add(id);
      if (zone === 'missing') {
        continue;
      }
      const config = createCameraConfig({ id });
      const engine = mock<CameraManagerEngine>();
      engine.getRecordingQueryPolicy.mockReturnValue(
        zone === 'generic'
          ? null
          : {
              maxWindowSeconds: 26 * 3600,
              timelineWindowMaxSeconds: 24 * 3600,
              segmentGapToleranceSeconds: 0,
              selectDate: true,
              exactTimeSelection: true,
              timeZone: zone,
            },
      );
      const camera =
        zone === 'generic'
          ? new Camera(config, engine)
          : new ShinobiCamera(config, engine);
      if (camera instanceof ShinobiCamera) {
        vi.spyOn(camera, 'getArchive').mockReturnValue({
          shinobi_recordings_entry: 'preview',
          shinobi_recordings_monitor: 'garden',
          shinobi_recordings_timezone: zone,
        });
      }
      store.addCamera(camera);
    }
    const hass = createHASS();
    hass.config = { ...hass.config, time_zone: 'Europe/London' };
    const controller = new TimelineController(mock<LitElement>());
    controller.setHass(hass);
    controller.setOptions({ cameraManager: createCameraManager(store) });
    const manager = mock<ViewManagerInterface>();
    manager.getView.mockReturnValue(
      createView({
        query: new UnifiedQuery([{ ...createRecordingQuery('unused'), cameraIDs }]),
      }),
    );
    await controller.setView({ manager });
    expect(controller.getDatePickerTimeZone()).toBe(expected);
  },
);

it('rejects an explicitly empty archive timezone instead of invoking legacy browser-local input', () => {
  expect(
    archiveIdentitySchema.safeParse({
      shinobi_recordings_entry: 'preview',
      shinobi_recordings_monitor: 'garden',
      shinobi_recordings_timezone: '',
    }).success,
  ).toBe(false);
});
