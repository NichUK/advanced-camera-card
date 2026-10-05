// @vitest-environment jsdom
import { assert, describe, expect, it, vi } from 'vitest';
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
  it('exposes quiet recording segments within a required viewport without inventing events', async () => {
    const { hass, walker, engine, store, query } = await setup();
    expect(
      engine.generateDefaultRecordingSegmentsQuery(store, query.cameraIDs, {}),
    ).toBeNull();
    expect(
      engine.generateDefaultRecordingSegmentsQuery(store, query.cameraIDs, { start }),
    ).toBeNull();
    const defaults = engine.generateDefaultRecordingSegmentsQuery(
      store,
      query.cameraIDs,
      { start, end },
    );
    expect(defaults).toEqual([
      {
        type: QueryType.RecordingSegments,
        cameraIDs: query.cameraIDs,
        start,
        end,
      },
    ]);
    const segmentsQuery = { ...query, type: QueryType.RecordingSegments as const };
    const result = await engine.getRecordingSegments(hass, store, segmentsQuery);
    expect([...result.values()]).toEqual([
      {
        engine: Engine.Shinobi,
        type: QueryResultsType.RecordingSegments,
        segments: [
          { id, start_time: start.getTime() / 1000, end_time: end.getTime() / 1000 },
        ],
      },
    ]);
    expect(walker.walk).toHaveBeenCalledOnce();
    walker.walk.mockResolvedValue([]);
    expect(
      [
        ...(await engine.getRecordingSegments(hass, store, segmentsQuery, {
          useCache: false,
        })),
      ].map(([, value]) => value.segments),
    ).toEqual([[]]);
  });

  it('coalesces identical pending metadata, reuses contained windows and expires them', async () => {
    const { hass, walker, engine, store, query } = await setup();
    let release: ((value: (typeof child)[]) => void) | undefined;
    const pending = new Promise<(typeof child)[]>((resolve) => {
      release = resolve;
    });
    walker.walk.mockReturnValueOnce(pending);
    const first = engine.getRecordings(hass, store, query);
    const contained = {
      ...query,
      start: new Date(start.getTime() + 30000),
      end: new Date(end.getTime() - 30000),
    };
    const second = engine.getRecordingSegments(hass, store, {
      ...query,
      type: QueryType.RecordingSegments,
    });
    assert(release);
    release([child]);
    await Promise.all([first, second]);
    expect(walker.walk).toHaveBeenCalledOnce();
    await engine.getRecordings(hass, store, contained);
    expect(walker.walk).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(new Date().getTime() + 31000));
      await engine.getRecordings(hass, store, query);
      expect(walker.walk).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
    await engine.getRecordings(hass, store, query, { useCache: false });
    expect(walker.walk).toHaveBeenCalledTimes(3);
  });

  it('filters cached coverage at half-open gaps, separates cameras and bounds retained windows', async () => {
    const { hass, walker, engine, store, query } = await setup();
    const broad = {
      ...query,
      start: new Date(start.getTime() - 60000),
      end: new Date(end.getTime() + 60000),
    };
    await engine.getRecordings(hass, store, broad);
    for (const bounds of [
      { start: broad.start, end: start },
      { start: end, end: broad.end },
    ]) {
      const contained = { ...query, ...bounds };
      const results = (await engine.getRecordings(hass, store, contained)).get(
        contained,
      );
      assert(results);
      expect(
        engine.generateMediaFromRecordings(hass, store, contained, results),
      ).toEqual([]);
    }
    expect(walker.walk).toHaveBeenCalledOnce();
    store.addCamera(
      await engine.createCamera(
        createCameraConfig({ id: 'second', camera_entity: 'camera.archive' }),
      ),
    );
    await engine.getRecordings(hass, store, {
      ...query,
      cameraIDs: new Set(['second']),
    });
    expect(walker.walk).toHaveBeenCalledTimes(2);
    walker.walk.mockResolvedValue([]);
    const windows = Array.from({ length: 20 }, (_, index) => ({
      ...query,
      start: new Date(end.getTime() + (index + 1) * 3600000),
      end: new Date(end.getTime() + (index + 1) * 3600000 + 60000),
    }));
    for (const window of windows) {
      await engine.getRecordings(hass, store, window);
    }
    await engine.getRecordings(hass, store, windows[19]);
    expect(walker.walk).toHaveBeenCalledTimes(22);
    await engine.getRecordings(hass, store, windows[0]);
    expect(walker.walk).toHaveBeenCalledTimes(23);
  });

  it('releases timed-out pending work so retry can request fresh metadata', async () => {
    const { hass, walker, engine, store, query } = await setup();
    let release: ((value: (typeof child)[]) => void) | undefined;
    const pending = new Promise<(typeof child)[]>((resolve) => {
      release = resolve;
    });
    walker.walk.mockReturnValueOnce(pending);
    vi.useFakeTimers();
    try {
      const stale = engine.getRecordings(hass, store, query);
      const failure = expect(stale).rejects.toThrow('metadata timeout');
      await vi.advanceTimersByTimeAsync(10000);
      await failure;
      walker.walk.mockResolvedValue([child]);
      await engine.getRecordings(hass, store, query);
      expect(walker.walk).toHaveBeenCalledTimes(2);
      assert(release);
      release([]);
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      const result = (await engine.getRecordings(hass, store, query)).get(query);
      assert(result);
      expect(
        engine.generateMediaFromRecordings(hass, store, query, result),
      ).toHaveLength(1);
      expect(walker.walk).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache failed metadata or silently overload pending requests', async () => {
    const { hass, walker, engine, store, query } = await setup();
    walker.walk.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(engine.getRecordings(hass, store, query)).rejects.toThrow(
      'Unavailable',
    );
    await engine.getRecordings(hass, store, query);
    expect(walker.walk).toHaveBeenCalledTimes(2);
    let release: ((value: (typeof child)[]) => void) | undefined;
    const pending = new Promise<(typeof child)[]>((resolve) => {
      release = resolve;
    });
    walker.walk.mockReturnValue(pending);
    const requests = Array.from({ length: 16 }, (_, index) =>
      engine.getRecordings(
        hass,
        store,
        {
          ...query,
          start: new Date(start.getTime() + index * 1000),
          end: new Date(end.getTime() + index * 1000),
        },
        { useCache: false },
      ),
    );
    await expect(
      engine.getRecordings(
        hass,
        store,
        {
          ...query,
          start: new Date(start.getTime() + 16000),
          end: new Date(end.getTime() + 16000),
        },
        { useCache: false },
      ),
    ).rejects.toThrow('requests busy');
    assert(release);
    release([]);
    await Promise.all(requests);
    walker.walk.mockResolvedValue(Array.from({ length: 10001 }, () => child));
    await expect(
      engine.getRecordings(hass, store, query, { useCache: false }),
    ).rejects.toThrow('metadata limit exceeded');
  });

  it('selects the next contiguous file at its half-open boundary and seeks across midnight', async () => {
    const { hass, engine, store } = await setup();
    const before = new ShinobiRecording(
      'camera',
      'before',
      'before',
      new Date('2026-10-01T23:59:00Z'),
      new Date('2026-10-02T00:01:00Z'),
    );
    const after = new ShinobiRecording(
      'camera',
      'after',
      'after',
      before.getEndTime(),
      new Date('2026-10-02T00:03:00Z'),
    );
    const boundary = new Date('2026-10-02T00:01:00Z');
    expect(findBestMediaTimeIndex([before, after], boundary)).toBe(1);
    expect(await engine.getMediaSeekTime(hass, store, before, boundary)).toBeNull();
    expect(await engine.getMediaSeekTime(hass, store, after, boundary)).toBe(0);
    expect(
      await engine.getMediaSeekTime(
        hass,
        store,
        before,
        new Date('2026-10-02T00:00:30Z'),
      ),
    ).toBe(90);
  });
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
      ...['', 'Infinity', 'NaN', ' 12', '0x10'].map((epoch) => ({
        media_content_id: contentID.replace(String(start.getTime() / 1000), epoch),
      })),
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
    const candidates = engine.generateMediaFromRecordings(hass, store, query, result);
    if (!candidates) {
      throw new Error('missing media');
    }
    expect(candidates[findBestMediaTimeIndex(candidates, start) ?? -1].getID()).toBe(
      `v1-${'0'.repeat(64)}`,
    );
    walker.walk.mockResolvedValue([
      { ...child, media_content_id: contentID.replace('a'.repeat(64), '0'.repeat(64)) },
      child,
    ]);
    const reversed = (await engine.getRecordings(hass, store, query)).get(query);
    if (!reversed) {
      throw new Error('missing reversed results');
    }
    expect(
      engine
        .generateMediaFromRecordings(hass, store, query, reversed)
        ?.map((media) => media.getID()),
    ).toEqual(candidates.map((media) => media.getID()));
  });
});
