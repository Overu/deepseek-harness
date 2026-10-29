import type { Config, DriveStep, Driver, DriverHook, PopoverDOM } from 'driver.js';
import type { ReactNode } from 'react';
import type { OnboardingContentProps } from './OnboardingContent';

export type OnboardingStepPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';
export type OnboardingStepAlign = 'start' | 'center' | 'end';

export interface OnboardingStep {
  id: string;
  target?: string | Element | (() => Element | null);
  title: string;
  description: string;
  image?: string;
  preview?: ReactNode;
  arrowColor?: string;
  placement?: OnboardingStepPlacement;
  align?: OnboardingStepAlign;
  showArrow?: boolean;
}

export interface OnboardingPopoverRenderContext {
  popover: PopoverDOM;
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  driver: Driver;
  arrowColor?: string;
  close: () => void;
  finish: () => void;
}

export interface OnboardingConfig {
  steps: OnboardingStep[];
  arrowColor?: string;
  closeOnOverlayClick?: boolean;
  driverOptions?: Omit<Config, 'steps' | 'onDestroyed' | 'onCloseClick' | 'onDoneClick' | 'onPopoverRender' | 'overlayClickBehavior'>;
  renderContent?: (props: OnboardingContentProps) => ReactNode;
  onClose?: () => void;
  onFinish?: () => void;
  onDestroyed?: () => void;
}

export interface UseLazyOnboardingDriverReturn {
  start: (stepIndex?: number) => Promise<void>;
  close: () => void;
  destroy: () => void;
  loading: boolean;
  isRunning: boolean;
}

export type DriverFactory = (options?: Config) => Driver;

export type DriverModule = {
  driver: DriverFactory;
};

export type { Config as DriverConfig, DriveStep, Driver, DriverHook, PopoverDOM };
