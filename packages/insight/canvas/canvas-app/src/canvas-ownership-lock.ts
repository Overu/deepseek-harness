/** Conditional document-lifetime ownership; timeouts never establish ownership. */
export function createCanvasOwnershipLock(canvasId: string, onHeld: (held: boolean) => void, locks = globalThis.navigator?.locks) {
  let held = false, disposed = false;
  let pending: Promise<boolean> | undefined, lifetime: Promise<unknown> | undefined;
  let releaseGate: (() => void) | undefined;
  const release = async () => {
    if (held) { held = false; onHeld(false); }
    releaseGate?.(); await lifetime;
  };
  const acquire = (): Promise<boolean> => {
    if (disposed || !locks) return Promise.resolve(false);
    if (held) return Promise.resolve(true);
    if (pending) return pending;
    let resolveResult!: (held: boolean) => void;
    const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
    pending = result;
    try {
      lifetime = locks.request(`insight-canvas-owner:v1:${canvasId}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock || disposed) { resolveResult(false); return; }
        const gate = new Promise<void>(resolve => { releaseGate = resolve; });
        held = true; onHeld(true); resolveResult(true);
        await gate; releaseGate = undefined;
      }).catch(() => { resolveResult(false); if (held) { held = false; onHeld(false); } });
    } catch { resolveResult(false); }
    void result.then(() => { if (pending === result) pending = undefined; });
    return result;
  };
  return { acquire, release, isHeld: () => held, supported: !!locks,
    dispose() { disposed = true; void release(); },
  };
}
