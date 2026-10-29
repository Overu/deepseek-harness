import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { useLazyOnboardingDriver } from './useLazyOnboardingDriver';
import type { OnboardingConfig, UseLazyOnboardingDriverReturn } from './types';

export interface OnboardingProps extends OnboardingConfig {
  children?: (controls: UseLazyOnboardingDriverReturn) => ReactNode;
}

export type OnboardingHandle = UseLazyOnboardingDriverReturn;

export const Onboarding = forwardRef<OnboardingHandle, OnboardingProps>(({ children, ...config }, ref) => {
  const controls = useLazyOnboardingDriver(config);

  useImperativeHandle(ref, () => controls, [controls]);

  return <>{children?.(controls)}</>;
});

Onboarding.displayName = 'Onboarding';
