import { LRUCache } from '../../cache/lru';
import type { CameraConfig } from '../../config/schema/cameras';
import type { HomeAssistant } from '../../ha/types';
import { QuerySource } from '../../query-source';
import { AdvancedCameraCardError } from '../../types';
import { withTimeout } from '../../utils/concurrency/with-timeout';
import type { ViewMedia } from '../../view/item';
import type { ViewItemCapabilities } from '../../view/types';
import { BrowseMediaCameraManagerEngine } from '../browse-media/engine-browse-media';
import type { CameraManagerReadOnlyConfigStore } from '../store';
import {
  Engine,
  QueryResultsType,
  QueryType,
  type EngineOptions,
  type PartialRecordingQuery,
  type PartialRecordingSegmentsQuery,
  type RecordingQuery,
  type RecordingQueryResults,
  type RecordingQueryResultsMap,
  type RecordingSegmentsQuery,
  type RecordingSegmentsQueryResultsMap,
} from '../types';
import { ShinobiCamera } from './camera';
import { ShinobiRecording } from './media';
import { clipIdentifierSchema, type ArchiveIdentity } from './types';

interface ShinobiRecordingResults extends RecordingQueryResults {
  media: ShinobiRecording[];
}

export class ShinobiCameraManagerEngine extends BrowseMediaCameraManagerEngine {
  private _windows = new LRUCache<
    string,
    {
      scope: string;
      start: Date;
      end: Date;
      expires: Date;
      recordings: ShinobiRecording[];
    }
  >(4);
  private _pending = new Map<
    string,
    {
      scope: string;
      start: Date;
      end: Date;
      work: Promise<ShinobiRecording[]>;
    }
  >();

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

  public override generateDefaultRecordingSegmentsQuery(
    _store: CameraManagerReadOnlyConfigStore,
    cameraIDs: Set<string>,
    query: PartialRecordingSegmentsQuery,
  ): RecordingSegmentsQuery[] | null {
    if (!query.start || !query.end) {
      return null;
    }
    return [
      {
        ...query,
        type: QueryType.RecordingSegments,
        cameraIDs,
        start: query.start,
        end: query.end,
      },
    ];
  }

  public override async getRecordingSegments(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: RecordingSegmentsQuery,
    engineOptions?: EngineOptions,
  ): Promise<RecordingSegmentsQueryResultsMap> {
    const output: RecordingSegmentsQueryResultsMap = new Map();
    await Promise.all(
      Array.from(query.cameraIDs, async (cameraID) => {
        const scopedQuery = { ...query, cameraIDs: new Set([cameraID]) };
        const recordings = await this._loadRecordings(
          hass,
          store,
          {
            ...scopedQuery,
            source: QuerySource.Camera,
            type: QueryType.Recording,
          },
          engineOptions,
        );
        output.set(scopedQuery, {
          engine: Engine.Shinobi,
          type: QueryResultsType.RecordingSegments,
          segments: recordings.map((recording) => ({
            id: recording.getID(),
            start_time: recording.getStartTime().getTime() / 1000,
            end_time: recording.getEndTime().getTime() / 1000,
          })),
        });
      }),
    );
    return output;
  }

  public override async getRecordings(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: RecordingQuery,
    engineOptions?: EngineOptions,
  ): Promise<RecordingQueryResultsMap> {
    const media = await this._loadRecordings(hass, store, query, engineOptions);
    const results: ShinobiRecordingResults = {
      engine: Engine.Shinobi,
      type: QueryResultsType.Recording,
      media,
    };
    return new Map([[query, results]]);
  }

  private async _loadRecordings(
    hass: HomeAssistant,
    store: CameraManagerReadOnlyConfigStore,
    query: RecordingQuery,
    engineOptions?: EngineOptions,
  ): Promise<ShinobiRecording[]> {
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
    const batches = await Promise.all(
      Array.from(query.cameraIDs, async (cameraID) => {
        const camera = store.getCamera(cameraID);
        const archive = camera instanceof ShinobiCamera ? camera.getArchive() : null;
        if (!archive) {
          throw new AdvancedCameraCardError('Shinobi recording camera unavailable');
        }
        return this._getCameraRecordings(
          hass,
          cameraID,
          archive,
          start,
          end,
          engineOptions?.useCache ?? true,
        );
      }),
    );
    const media = batches.flat();
    media.sort(
      (a, b) =>
        a.getStartTime().getTime() - b.getStartTime().getTime() ||
        a.getID().localeCompare(b.getID()),
    );
    return media;
  }

  private async _getCameraRecordings(
    hass: HomeAssistant,
    cameraID: string,
    archive: ArchiveIdentity,
    start: Date,
    end: Date,
    useCache: boolean,
  ): Promise<ShinobiRecording[]> {
    const scope = `${cameraID}|${archive.shinobi_recordings_entry}|${archive.shinobi_recordings_monitor}`;
    const filter = (recordings: ShinobiRecording[]): ShinobiRecording[] =>
      recordings.filter(
        (recording) => recording.getStartTime() < end && recording.getEndTime() > start,
      );
    if (useCache) {
      for (const [key, cached] of this._windows.entries()) {
        if (cached.expires <= new Date()) {
          this._windows.delete(key);
        } else if (
          cached.scope === scope &&
          cached.start <= start &&
          cached.end >= end
        ) {
          this._windows.get(key);
          return filter(cached.recordings);
        }
      }
    }
    for (const pending of this._pending.values()) {
      if (
        pending.scope === scope &&
        pending.start.getTime() === start.getTime() &&
        pending.end.getTime() === end.getTime()
      ) {
        return filter(await pending.work);
      }
    }
    if (this._pending.size >= 16) {
      throw new AdvancedCameraCardError(
        'Recording requests busy; retry the selected time',
      );
    }
    const key = `${scope}|${start.getTime()}|${end.getTime()}`;
    const work = withTimeout(
      this._fetchCameraRecordings(hass, cameraID, archive, start, end),
      10000,
      new AdvancedCameraCardError('Recording metadata timeout'),
    );
    this._pending.set(key, { scope, start, end, work });
    try {
      const recordings = await work;
      if (useCache) {
        this._windows.set(key, {
          scope,
          start,
          end,
          expires: new Date(new Date().getTime() + 30000),
          recordings,
        });
      }
      return recordings;
    } finally {
      this._pending.delete(key);
    }
  }

  private async _fetchCameraRecordings(
    hass: HomeAssistant,
    cameraID: string,
    archive: ArchiveIdentity,
    start: Date,
    end: Date,
  ): Promise<ShinobiRecording[]> {
    const media: ShinobiRecording[] = [];
    const children = await this._browseMediaWalker.walk(hass, [
      {
        targets: [
          `media-source://shinobi_recordings/window|${archive.shinobi_recordings_entry}|${archive.shinobi_recordings_monitor}|${start.getTime() / 1000}|${end.getTime() / 1000}`,
        ],
      },
    ]);
    if (children.length > 10000) {
      throw new AdvancedCameraCardError('Recording metadata limit exceeded');
    }
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
    return media;
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
