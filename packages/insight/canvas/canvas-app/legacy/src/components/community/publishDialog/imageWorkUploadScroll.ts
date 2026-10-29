export interface ThumbnailScrollState {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

export const getThumbnailScrollState = (scrollLeft: number, clientWidth: number, scrollWidth: number): ThumbnailScrollState => {
  const maxScrollLeft = scrollWidth - clientWidth;
  const hasOverflow = maxScrollLeft > 1;

  return {
    hasOverflow,
    canScrollLeft: hasOverflow && scrollLeft > 1,
    canScrollRight: hasOverflow && scrollLeft < maxScrollLeft - 1,
  };
};
