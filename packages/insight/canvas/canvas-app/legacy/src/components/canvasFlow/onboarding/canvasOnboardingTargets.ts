export const CANVAS_ONBOARDING_STORAGE_KEY = 'canvas:onboarding:v1';

export const CANVAS_ONBOARDING_TARGETS = {
  center: 'canvas-center',
  basicNodes: 'canvas-basic-nodes',
  toolNodes: 'canvas-tool-nodes',
  assets: 'canvas-assets',
  templates: 'canvas-templates',
  share: 'canvas-share',
} as const;

export type CanvasOnboardingTarget = (typeof CANVAS_ONBOARDING_TARGETS)[keyof typeof CANVAS_ONBOARDING_TARGETS];

export const getCanvasOnboardingSelector = (target: CanvasOnboardingTarget) => `[data-onboarding-target="${target}"]`;
