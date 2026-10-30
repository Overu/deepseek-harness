export interface CanvasVersionBarrier {
  runPolling<T>(request: () => Promise<T>, onResponse: (response: T) => boolean): Promise<T>;
  beginMutation(): () => void;
  waitPollingIdle(): Promise<void>;
  consumeUncertain(): boolean;
  isUncertain(): boolean;
}

export function createCanvasVersionBarrier(): CanvasVersionBarrier {
  let activePollingCount = 0;
  let pendingMutationCount = 0;
  let versionUncertain = false;

  const pollingIdleWaiters = new Set<() => void>();
  const mutationIdleWaiters = new Set<() => void>();

  const resolveWaiters = (waiters: Set<() => void>) => {
    waiters.forEach(resolve => resolve());
    waiters.clear();
  };

  const acquirePollingSlot = async () => {
    while (pendingMutationCount > 0) {
      await new Promise<void>(resolve => mutationIdleWaiters.add(resolve));
    }
    activePollingCount += 1;
  };

  const runCanvasVersionPolling = async <T>(request: () => Promise<T>, onResponse: (response: T) => boolean) => {
    await acquirePollingSlot();

    try {
      const response = await request();
      if (!onResponse(response)) versionUncertain = true;
      return response;
    } catch (error) {
      versionUncertain = true;
      throw error;
    } finally {
      activePollingCount -= 1;
      if (activePollingCount === 0) resolveWaiters(pollingIdleWaiters);
    }
  };

  const beginCanvasVersionMutation = () => {
    pendingMutationCount += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      pendingMutationCount -= 1;
      if (pendingMutationCount === 0) resolveWaiters(mutationIdleWaiters);
    };
  };

  const waitForCanvasVersionPolling = async () => {
    while (activePollingCount > 0) {
      await new Promise<void>(resolve => pollingIdleWaiters.add(resolve));
    }
  };

  const consumeCanvasVersionUncertain = () => {
    const uncertain = versionUncertain;
    versionUncertain = false;
    return uncertain;
  };

  const isUncertain = () => versionUncertain;

  return { runPolling: runCanvasVersionPolling, beginMutation: beginCanvasVersionMutation, waitPollingIdle: waitForCanvasVersionPolling, consumeUncertain: consumeCanvasVersionUncertain, isUncertain };
}

// Compatibility instance used by the existing standalone canvas UI.
export const defaultCanvasVersionBarrier = createCanvasVersionBarrier();
export const runCanvasVersionPolling = defaultCanvasVersionBarrier.runPolling;
export const beginCanvasVersionMutation = defaultCanvasVersionBarrier.beginMutation;
export const waitForCanvasVersionPolling = defaultCanvasVersionBarrier.waitPollingIdle;
export const consumeCanvasVersionUncertain = defaultCanvasVersionBarrier.consumeUncertain;

export function isVersionConflict(error: any) {
  return String(error?.code ?? error?.raw?.code ?? error?.raw?.raw?.code) === '5011';
}
