import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { ShinobiCameraManagerEngine } from '../../../src/camera-manager/shinobi/engine-shinobi';
import { ShinobiRecording } from '../../../src/camera-manager/shinobi/media';
import { CameraManagerStore } from '../../../src/camera-manager/store';
import {
  CameraManagerRequestCache,
  Engine,
  QueryResultsType,
  QueryType,
} from '../../../src/camera-manager/types';
import type { BrowseMediaWalker } from '../../../src/ha/browse-media/walker';
import type { ResolvedMediaCache } from '../../../src/ha/resolved-media';
import { QuerySource } from '../../../src/query-source';
import { findBestMediaTimeIndex } from '../../../src/utils/find-best-media-time-index';
import { ViewMedia, ViewMediaType } from '../../../src/view/item';
import { createCameraConfig } from '../../config/test-utils';
import { EntityRegistryManagerMock } from '../../ha/registry/entity/mock';
import {
  createHASS,
  createHASSManager,
  createRegistryEntity,
  createStateEntity,
} from '../../test-utils';

const start = new Date('2026-10-02T12:34:00Z');
const end = new Date('2026-10-02T12:36:00Z');
const id = `v1-${'a'.repeat(64)}`;
const contentID = `media-source://shinobi_recordings/clip|preview|garden|${id}|${start.getTime() / 1000}|${end.getTime() / 1000}`;
const child = {
  title: 'Recording',
  media_class: 'video',
  media_content_type: 'video/mp4',
  media_content_id: contentID,
  can_play: true,
  can_expand: false,
  thumbnail: null,
};
const setup = async () => {
  const hass = createHASS({
    'camera.archive': createStateEntity({
      attributes: {
        shinobi_recordings_entry: 'preview',
        shinobi_recordings_monitor: 'garden',
      },
    }),
  });
  const walker = mock<BrowseMediaWalker>();
  walker.walk.mockResolvedValue([child]);
  const engine = new ShinobiCameraManagerEngine(
    new EntityRegistryManagerMock([
      createRegistryEntity({
        entity_id: 'camera.archive',
        platform: 'shinobi_recordings',
      }),
    ]),
    createHASSManager({ hass }),
    walker,
    mock<ResolvedMediaCache>(),
    new CameraManagerRequestCache(),
  );
  const store = new CameraManagerStore();
  store.addCamera(
    await engine.createCamera(
      createCameraConfig({ id: 'archive', camera_entity: 'camera.archive' }),
    ),
  );
  const query = {
    source: QuerySource.Camera as const,
    type: QueryType.Recording as const,
    cameraIDs: new Set(['archive']),
    start,
    end,
  };
  return { hass, walker, engine, store, query };
};

describe('Shinobi historical recording selection', () => {
  it('queries a bounded window and seeks the covering original file to 60 seconds', async () => {
    const { hass, walker, engine, store, query } = await setup();
    const results = await engine.getRecordings(hass, store, query);
    const result = results.get(query);
    expect(result).toBeDefined();
    if (!result) {
      throw new Error('missing results');
    }
    const media = engine.generateMediaFromRecordings(hass, store, query, result);
    expect(media).toHaveLength(1);
    if (!media) {
      throw new Error('missing media');
    }
    expect(walker.walk).toHaveBeenCalledWith(hass, [
      {
        targets: [
          `media-source://shinobi_recordings/window|preview|garden|${start.getTime() / 1000}|${end.getTime() / 1000}`,
        ],
      },
    ]);
    expect(findBestMediaTimeIndex(media, new Date('2026-10-02T12:35:00Z'))).toBe(0);
    expect(findBestMediaTimeIndex(media, end)).toBeNull();
    expect(
      await engine.getMediaSeekTime(
        hass,
        store,
        media[0],
        new Date('2026-10-02T12:35:00Z'),
      ),
    ).toBe(60);
    expect(await engine.getMediaSeekTime(hass, store, media[0], end)).toBeNull();
    expect(
      await engine.getMediaSeekTime(
        hass,
        store,
        new ViewMedia(ViewMediaType.Clip),
        start,
      ),
    ).toBeNull();
    expect(media[0].getID()).toBe(id);
    expect(media[0].getContentID()).toBe(contentID);
    expect(media[0].getTitle()).toBe(start.toISOString());
    expect(media[0].inProgress()).toBe(false);
    expect(media[0].requiresExactTimeSelection()).toBe(true);
    expect(new ViewMedia(ViewMediaType.Clip).requiresExactTimeSelection()).toBe(false);
    expect(media[0] instanceof ShinobiRecording && media[0].getEventCount()).toBeNull();
  });
  it('never turns invalid or foreign metadata into empty complete coverage', async () => {
    const { hass, walker, engine, store, query } = await setup();
    for (const modification of [
      { media_content_id: 'invalid' },
      { media_content_id: contentID.replace('|preview|', '|foreign|') },
      { media_content_id: contentID.replace('|garden|', '|foreign|') },
      { can_play: false },
      { media_content_type: 'image/jpeg' },
    ]) {
      walker.walk.mockResolvedValue([{ ...child, ...modification }]);
      await expect(engine.getRecordings(hass, store, query)).rejects.toThrow(
        'Invalid Shinobi recording metadata',
      );
    }
    walker.walk.mockResolvedValue([child]);
    await expect(
      engine.getRecordings(hass, store, {
        ...query,
        start: end,
        end: new Date(end.getTime() + 60000),
      }),
    ).rejects.toThrow('outside requested interval');
    await expect(
      engine.getRecordings(hass, store, { ...query, cameraIDs: new Set(['missing']) }),
    ).rejects.toThrow('camera unavailable');
    for (const bounds of [
      { start: end, end: start },
      { start: new Date('invalid'), end },
      { start, end: new Date('invalid') },
      { start, end: new Date(start.getTime() + 27 * 3600000) },
    ]) {
      await expect(
        engine.getRecordings(hass, store, { ...query, ...bounds }),
      ).rejects.toThrow('Invalid recording interval');
    }
  });
  it('provides a bounded default window and returns only classified recording results', async () => {
    const { hass, walker, engine, store, query } = await setup();
    walker.walk.mockResolvedValue([]);
    const generated = engine.generateDefaultRecordingQuery(store, query.cameraIDs, {});
    expect(generated[0]).toEqual({
      source: QuerySource.Camera,
      type: QueryType.Recording,
      cameraIDs: query.cameraIDs,
    });
    expect((await engine.getRecordings(hass, store, generated[0])).size).toBe(1);
    expect(
      engine.generateMediaFromRecordings(hass, store, query, {
        type: QueryResultsType.Recording,
        engine: Engine.Generic,
      }),
    ).toBeNull();
    expect(
      engine.generateMediaFromRecordings(hass, store, query, {
        type: QueryResultsType.Recording,
        engine: Engine.Shinobi,
      }),
    ).toBeNull();
  });
  it('orders overlap candidates deterministically regardless of upstream ordering', async () => {
    const { hass, walker, engine, store, query } = await setup();
    walker.walk.mockResolvedValue([
      child,
      { ...child, media_content_id: contentID.replace('a'.repeat(64), '0'.repeat(64)) },
    ]);
    const result = (await engine.getRecordings(hass, store, query)).get(query);
    if (!result) {
      throw new Error('missing results');
    }
    expect(
      engine
        .generateMediaFromRecordings(hass, store, query, result)
        ?.map((media) => media.getID()),
    ).toEqual([`v1-${'0'.repeat(64)}`, id]);
  });
});
