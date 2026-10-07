import type { Camera } from './camera';

/** Optional policies for engines exposing exact, completed recording files. */
export interface RecordingQueryPolicy {
  maxWindowSeconds: number;
  timelineWindowMaxSeconds: number;
  segmentGapToleranceSeconds: number;
  selectDate: boolean;
  exactTimeSelection: boolean;
  timeZone?: string;
}

export const getRecordingQueryPolicy = (
  camera?: Camera | null,
): RecordingQueryPolicy | null =>
  camera?.getEngine().getRecordingQueryPolicy(camera) ?? null;
