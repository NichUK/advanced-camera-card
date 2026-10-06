import type { HomeAssistant } from '../../ha/types';
import type { CapabilitiesRaw } from '../../types';
import type { CameraInitializationOptions } from '../camera';
import { EntityCamera } from '../entity-camera';
import { ShinobiInitializationError } from '../error';
import { archiveIdentitySchema, type ArchiveIdentity } from './types';

export class ShinobiCamera extends EntityCamera {
  private _archive: ArchiveIdentity | null = null;

  protected override async _initializeBeforeCapabilities(
    hass: HomeAssistant,
    options: CameraInitializationOptions,
  ): Promise<void> {
    await super._initializeBeforeCapabilities(hass, options);
    const identity = archiveIdentitySchema.safeParse(
      // EntityCamera already rejects a missing registry entity.
      /* v8 ignore next -- @preserve */
      this._entity ? hass.states[this._entity.entity_id]?.attributes : null,
    );
    if (this._entity?.platform !== 'shinobi_recordings' || !identity.success) {
      throw new ShinobiInitializationError();
    }
    this._archive = identity.data;
  }

  public getArchive(): ArchiveIdentity | null {
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
