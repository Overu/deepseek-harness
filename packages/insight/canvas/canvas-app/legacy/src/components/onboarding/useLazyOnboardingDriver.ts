import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanupOnboardingPopovers, renderOnboardingPopover } from './onboardingPopoverRenderer';
import type { Driver, DriverConfig, DriverModule, DriveStep, OnboardingConfig, OnboardingStep, UseLazyOnboardingDriverReturn } from './types';

const DEFAULT_DRIVER_OPTIONS: DriverConfig = {
  animate: true,
  allowClose: true,
  allowKeyboardControl: true,
  disableActiveInteraction: true,
  overlayOpacity: 0.58,
  popoverClass: 'ins-onboarding-popover',
  showButtons: ['next', 'previous', 'close'],
  showProgress: false,
  skipMissingElement: true,
  stagePadding: 8,
  stageRadius: 8,
  nextBtnText: '下一步',
  prevBtnText: '上一步',
  doneBtnText: '完成',
};

const noopOverlayClick = () => undefined;

const resolveTarget = (target: OnboardingStep['target']) => {
  if (!target) {
    return undefined;
  }

  if (typeof target === 'function') {
    return () => target() ?? document.body;
  }

  return target;
};

const getStepSide = (placement: OnboardingStep['placement']) => {
  return placement === 'center' ? undefined : placement;
};

const createDriveSteps = (getConfig: () => OnboardingConfig, getDriver: () => Driver | null): DriveStep[] => {
  const initialConfig = getConfig();
  return initialConfig.steps.map((step, index) => ({
    element: resolveTarget(step.target),
    popover: {
      title: step.title,
      description: step.description,
      side: getStepSide(step.placement),
      align: step.align || 'center',
      onPopoverRender: popover => {
        const driver = getDriver();
        if (!driver) return;
        const currentConfig = getConfig();
        const currentStep = currentConfig.steps[index] || step;

        renderOnboardingPopover(
          {
            popover,
            step: currentStep,
            stepIndex: index,
            totalSteps: currentConfig.steps.length,
            driver,
            arrowColor: currentStep.arrowColor || currentConfig.arrowColor,
            close: () => {
              currentConfig.onClose?.();
              driver.destroy();
            },
            finish: () => {
              currentConfig.onFinish?.();
              driver.destroy();
            },
          },
          currentConfig.renderContent
        );
      },
    },
    data: step,
  }));
};

export function useLazyOnboardingDriver(config: OnboardingConfig): UseLazyOnboardingDriverReturn {
  const configRef = useRef(config);
  const driverRef = useRef<Driver | null>(null);
  const driverLoaderRef = useRef<Promise<DriverModule> | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const loadDriver = useCallback(async () => {
    if (!driverLoaderRef.current) {
      driverLoaderRef.current = Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]).then(([module]) => module);
    }

    return driverLoaderRef.current;
  }, []);

  const close = useCallback(() => {
    const currentConfig = configRef.current;
    currentConfig.onClose?.();
    driverRef.current?.destroy();
    cleanupOnboardingPopovers();
    setIsRunning(false);
  }, []);

  const destroy = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
    cleanupOnboardingPopovers();
    setIsRunning(false);
  }, []);

  const start = useCallback(
    async (stepIndex = 0) => {
      const currentConfig = configRef.current;
      if (!currentConfig.steps.length) {
        return;
      }

      setLoading(true);
      try {
        const { driver } = await loadDriver();

        driverRef.current?.destroy();
        const instance = driver({
          ...DEFAULT_DRIVER_OPTIONS,
          ...currentConfig.driverOptions,
          overlayClickBehavior: currentConfig.closeOnOverlayClick ? 'close' : noopOverlayClick,
          steps: createDriveSteps(
            () => configRef.current,
            () => driverRef.current
          ),
          onCloseClick: (_element, _step, opts) => {
            currentConfig.onClose?.();
            opts.driver.destroy();
          },
          onDoneClick: (_element, _step, opts) => {
            currentConfig.onFinish?.();
            opts.driver.destroy();
          },
          onDestroyed: () => {
            cleanupOnboardingPopovers();
            currentConfig.onDestroyed?.();
            setIsRunning(false);
          },
        });

        driverRef.current = instance;
        setIsRunning(true);
        instance.drive(stepIndex);
      } finally {
        setLoading(false);
      }
    },
    [loadDriver]
  );

  useEffect(() => destroy, [destroy]);

  return {
    start,
    close,
    destroy,
    loading,
    isRunning,
  };
}
