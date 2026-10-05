import { z } from 'zod';

import type { HomeAssistant } from '../../ha/types';
import type { CapabilitiesRaw } from '../../types';
import type { CameraInitializationOptions } from '../camera';
import { EntityCamera } from '../entity-camera';
import { ShinobiInitializationError } from '../error';

const identitySchema = z.object({
  shinobi_recordings_entry: z.string().regex(/^[A-Za-z0-9_-]+$/),
  shinobi_recordings_monitor: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

export class ShinobiCamera extends EntityCamera {
  private _archive: z.infer<typeof identitySchema> | null = null;

  protected override async _initializeBeforeCapabilities(
    hass: HomeAssistant,
    options: CameraInitializationOptions,
  ): Promise<void> {
    await super._initializeBeforeCapabilities(hass, options);
    const identity = identitySchema.safeParse(
      // EntityCamera already rejects a missing registry entity.
      /* v8 ignore next -- @preserve */
      this._entity ? hass.states[this._entity.entity_id]?.attributes : null,
    );
    if (this._entity?.platform !== 'shinobi_recordings' || !identity.success) {
      throw new ShinobiInitializationError();
    }
    this._archive = identity.data;
  }

  public getArchive(): z.infer<typeof identitySchema> | null {
    return this._archive;
  }

  protected override async _getRawCapabilities(): Promise<CapabilitiesRaw> {
    return {
      live: false,
      menu: true,
      substream: false,
      trigger: false,
      'remote-control-entity': false,
    };
  }

  protected override async _has2WayAudioCapability(): Promise<boolean> {
    return false;
  }
}
