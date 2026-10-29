export type MattingBrushMode = 'remove' | 'keep';

export const MATTING_MASK_COLORS: Record<MattingBrushMode, string> = {
  remove: 'rgb(59, 130, 246)',
  keep: 'rgb(16, 185, 129)',
};
