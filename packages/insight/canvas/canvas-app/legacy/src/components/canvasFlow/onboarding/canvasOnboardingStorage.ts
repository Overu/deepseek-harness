const COMPLETED_VALUE = 'completed';

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function isCanvasOnboardingFinished(storageKey: string): boolean {
  if (!storageKey || !canUseLocalStorage()) {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === COMPLETED_VALUE;
  } catch {
    return false;
  }
}

export function markCanvasOnboardingFinished(storageKey: string) {
  if (!storageKey || !canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, COMPLETED_VALUE);
  } catch {
    // Ignore storage failures, such as private mode quota errors.
  }
}

export function resetCanvasOnboarding(storageKey: string) {
  if (!storageKey || !canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures, such as private mode quota errors.
  }
}

export function shouldLoadCanvasOnboarding(storageKey: string): boolean {
  return !isCanvasOnboardingFinished(storageKey);
}
