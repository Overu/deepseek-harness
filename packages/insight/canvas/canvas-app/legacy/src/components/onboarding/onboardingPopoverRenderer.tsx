import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { OnboardingContent } from './OnboardingContent';
import type { ReactNode } from 'react';
import type { OnboardingContentProps } from './OnboardingContent';
import type { OnboardingPopoverRenderContext } from './types';

interface PopoverRootEntry {
  root: Root;
  container: HTMLDivElement;
}

const roots = new WeakMap<HTMLElement, PopoverRootEntry>();
const mountedEntries = new Set<PopoverRootEntry>();

const prepareDriverArrow = (context: OnboardingPopoverRenderContext) => {
  const { popover, step, arrowColor } = context;
  if (arrowColor) {
    popover.wrapper.style.setProperty('--ins-onboarding-arrow-color', arrowColor);
  } else {
    popover.wrapper.style.removeProperty('--ins-onboarding-arrow-color');
  }
  popover.arrow.style.display = step.showArrow === false || step.placement === 'center' ? 'none' : '';
};

export function renderOnboardingPopover(context: OnboardingPopoverRenderContext, renderContent?: (props: OnboardingContentProps) => ReactNode) {
  const { popover, step, stepIndex, totalSteps, driver, close, finish } = context;

  popover.wrapper.classList.add('ins-onboarding-popover-wrapper');
  prepareDriverArrow(context);

  let entry = roots.get(popover.wrapper);

  if (!entry) {
    popover.wrapper.innerHTML = '';
    popover.wrapper.appendChild(popover.arrow);

    const container = document.createElement('div');
    container.className = 'ins-onboarding-popover-content';
    popover.wrapper.appendChild(container);

    const root = createRoot(container);
    entry = { root, container };
    roots.set(popover.wrapper, entry);
    mountedEntries.add(entry);
  }

  const contentProps: OnboardingContentProps = {
    step,
    stepIndex,
    totalSteps,
    canGoPrevious: driver.hasPreviousStep(),
    canGoNext: true,
    onClose: close,
    onPrevious: () => driver.movePrevious(),
    onNext: () => {
      if (driver.hasNextStep()) {
        driver.moveNext();
        return;
      }

      finish();
    },
  };

  flushSync(() => {
    entry.root.render(renderContent ? renderContent(contentProps) : <OnboardingContent {...contentProps} />);
  });
}

export function cleanupOnboardingPopover(context: OnboardingPopoverRenderContext) {
  const entry = roots.get(context.popover.wrapper);
  if (entry) {
    entry.root.unmount();
    mountedEntries.delete(entry);
    roots.delete(context.popover.wrapper);
  }
}

export function cleanupOnboardingPopovers() {
  mountedEntries.forEach(entry => entry.root.unmount());
  mountedEntries.clear();
}
