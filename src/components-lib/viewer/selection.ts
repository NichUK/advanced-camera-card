import type { ViewItem, ViewMedia } from '../../view/item';

export const getViewerMediaIndex = (
  media: readonly ViewMedia[] | null,
  selected: ViewItem | null,
): number | null => {
  if (!media?.length) {
    return null;
  }
  const index = media.findIndex((item) => item === selected);
  if (index >= 0) {
    return index;
  }
  // An exact archive selection can deliberately be empty inside a gap.
  if (media.every((item) => item.requiresExactTimeSelection())) {
    return null;
  }
  return media.length - 1;
};
