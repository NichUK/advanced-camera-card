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
  for (let index = media.length - 1; index >= 0; index--) {
    if (!media[index].requiresExactTimeSelection()) {
      return index;
    }
  }
  return null;
};
