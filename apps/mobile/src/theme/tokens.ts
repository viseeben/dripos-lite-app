/** 4pt base grid. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  pill: 999,
} as const;

/** iOS HIG minimum touch target. */
export const MIN_TOUCH_TARGET = 44;

export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;
