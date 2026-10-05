import type { CameraConfig } from '../../config/schema/cameras';
import type { ViewItemCapabilities } from '../../view/types';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import { Engine } from '../types';
import { ShinobiCamera } from './camera';

export class ShinobiCameraManagerEngine extends BrowseMediaCameraManagerEngine {
  public override getEngineType(): Engine {
    return Engine.Shinobi;
  }

  public override async createCamera(
    cameraConfig: CameraConfig,
  ): Promise<ShinobiCamera> {
    return await new ShinobiCamera(cameraConfig, this, {
      eventCallback: this._eventCallback,
    }).initialize({
      hassManager: this._hassManager,
      entityRegistryManager: this._entityRegistryManager,
    });
  }

  public override getMediaCapabilities(): ViewItemCapabilities {
    return { canFavorite: false, canDownload: false };
  }
}
