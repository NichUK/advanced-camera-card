import type { CameraConfig } from '../../config/schema/cameras';
import type { HomeAssistant } from '../../ha/types';
import { QuerySource } from '../../query-source';
import { AdvancedCameraCardError } from '../../types';
import type { ViewMedia } from '../../view/item';
import type { ViewItemCapabilities } from '../../view/types';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import type { CameraManagerReadOnlyConfigStore } from '../store';
import {
  Engine,
  QueryResultsType,
  QueryType,
  type PartialRecordingQuery,
  type RecordingQuery,
  type RecordingQueryResults,
  type RecordingQueryResultsMap,
} from '../types';
import { ShinobiCamera } from './camera';
import { ShinobiRecording } from './media';
import { clipIdentifierSchema } from './types';

interface ShinobiRecordingResults extends RecordingQueryResults {
  media: ShinobiRecording[];
}

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

  public override generateDefaultRecordingQuery(
    _store: CameraManagerReadOnlyConfigStore,
    cameraIDs: Set<string>,
    query: PartialRecordingQuery,
  ): RecordingQuery[] {
    return [
      { source: QuerySource.Camera, type: QueryType.Recording, cameraIDs, ...query },
    ];
  }

  public override async getRecordings(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: RecordingQuery,
  ): Promise<RecordingQueryResultsMap> {
    const end = query.end ?? new Date();
    const start = query.start ?? new Date(end.getTime() - 3600000);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      end.getTime() - start.getTime() > 26 * 3600000
    ) {
      throw new AdvancedCameraCardError('Invalid recording interval');
    }
    const media: ShinobiRecording[] = [];
    for (const cameraID of query.cameraIDs) {
      const camera = store.getCamera(cameraID);
      const archive = camera instanceof ShinobiCamera ? camera.getArchive() : null;
      if (!archive) {
        throw new AdvancedCameraCardError('Shinobi recording camera unavailable');
      }
      const children = await this._browseMediaWalker.walk(hass, [
        {
          targets: [
            `media-source://shinobi_recordings/window|${archive.shinobi_recordings_entry}|${archive.shinobi_recordings_monitor}|${start.getTime() / 1000}|${end.getTime() / 1000}`,
          ],
        },
      ]);
      for (const child of children) {
        const result = clipIdentifierSchema.safeParse(child.media_content_id.split('|'));
        if (
          !result.success ||
          result.data[1] !== archive.shinobi_recordings_entry ||
          result.data[2] !== archive.shinobi_recordings_monitor ||
          !child.can_play ||
          child.media_content_type !== 'video/mp4'
        ) {
          throw new AdvancedCameraCardError('Invalid Shinobi recording metadata');
        }
        const [, , , id, begin, finish] = result.data;
        if (begin * 1000 >= end.getTime() || finish * 1000 <= start.getTime()) {
          throw new AdvancedCameraCardError('Recording outside requested interval');
        }
        media.push(
          new ShinobiRecording(
            cameraID,
            child.media_content_id,
            id,
            new Date(begin * 1000),
            new Date(finish * 1000),
          ),
        );
      }
    }
    media.sort(
      (a, b) =>
        a.getStartTime().getTime() - b.getStartTime().getTime() ||
        a.getID().localeCompare(b.getID()),
    );
    const results: ShinobiRecordingResults = {
      engine: Engine.Shinobi,
      type: QueryResultsType.Recording,
      media,
    };
    return new Map([[query, results]]);
  }

  public override generateMediaFromRecordings(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    _query: RecordingQuery,
    results: RecordingQueryResults,
  ): ViewMedia[] | null {
    if (
      results.engine !== Engine.Shinobi ||
      !('media' in results) ||
      !Array.isArray(results.media) ||
      !results.media.every((item: unknown) => item instanceof ShinobiRecording)
    ) {
      return null;
    }
    return results.media;
  }

  public override async getMediaSeekTime(
    _hass: HomeAssistant,
    _store: CameraManagerReadOnlyConfigStore,
    media: ViewMedia,
    target: Date,
  ): Promise<number | null> {
    return media instanceof ShinobiRecording && media.includesTime(target)
      ? (target.getTime() - media.getStartTime().getTime()) / 1000
      : null;
  }
}
