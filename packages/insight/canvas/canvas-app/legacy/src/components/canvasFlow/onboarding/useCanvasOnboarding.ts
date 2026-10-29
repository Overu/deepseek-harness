import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLazyOnboardingDriver, type OnboardingConfig } from '@/components/onboarding';
import { canvasOnboardingSteps } from './canvasOnboardingSteps';
import { markCanvasOnboardingFinished, resetCanvasOnboarding, shouldLoadCanvasOnboarding } from './canvasOnboardingStorage';
import { CANVAS_ONBOARDING_STORAGE_KEY } from './canvasOnboardingTargets';

interface UseCanvasOnboardingOptions {
  enabled?: boolean;
  loading?: boolean;
  readOnly?: boolean;
  autoStart?: boolean;
  arrowColor?: OnboardingConfig['arrowColor'];
  renderContent?: OnboardingConfig['renderContent'];
}

export function useCanvasOnboarding({ enabled = true, loading = false, readOnly = false, autoStart = true, arrowColor, renderContent }: UseCanvasOnboardingOptions = {}) {
  const autoStartedRef = useRef(false);
  const onboardingConfig = useMemo<OnboardingConfig>(
    () => ({
      steps: canvasOnboardingSteps,
      arrowColor,
      closeOnOverlayClick: false,
      renderContent,
      onClose: () => {
        markCanvasOnboardingFinished(CANVAS_ONBOARDING_STORAGE_KEY);
      },
      onFinish: () => {
        markCanvasOnboardingFinished(CANVAS_ONBOARDING_STORAGE_KEY);
      },
      driverOptions: {
        popoverOffset: 12,
        skipMissingElement: true,
        stagePadding: 8,
        stageRadius: 8,
      },
    }),
    [arrowColor, renderContent]
  );
  const onboarding = useLazyOnboardingDriver(onboardingConfig);

  useEffect(() => {
    if (!autoStart || !enabled || loading || readOnly || autoStartedRef.current) {
      return;
    }

    autoStartedRef.current = true;
    if (!shouldLoadCanvasOnboarding(CANVAS_ONBOARDING_STORAGE_KEY)) {
      return;
    }

    void onboarding.start();
  }, [autoStart, enabled, loading, readOnly, onboarding.start]);

  const restart = useCallback(async () => {
    resetCanvasOnboarding(CANVAS_ONBOARDING_STORAGE_KEY);
    await onboarding.start();
  }, [onboarding.start]);

  return {
    ...onboarding,
    restart,
    storageKey: CANVAS_ONBOARDING_STORAGE_KEY,
  };
}
