import { createTestLockManager } from './lock-manager-fixture';

if (typeof navigator !== 'undefined' && !navigator.locks) {
  Object.defineProperty(navigator, 'locks', { value: createTestLockManager(), configurable: true });
}
