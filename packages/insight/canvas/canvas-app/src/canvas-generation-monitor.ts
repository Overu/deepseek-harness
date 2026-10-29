import { getFlowData } from '../legacy/src/api/workflow';
import type { FlowStoreApi } from '../legacy/src/store/flowStoreCore';
import type { CanvasVersionBarrier } from '../legacy/src/lib/canvasVersionBarrier';
import type { PointStoreApi } from '../legacy/src/store/pointStore';
import type { CanvasRunObservation } from './canvas-run-tracker';
import { isTrustedCanvasVersion } from './canvas-initialization';

/** Extracted native poller: 200ms initial, 3s running, 10s error, six errors and 5s refund check. */
export function createCanvasGenerationMonitor(store: FlowStoreApi, barrier: CanvasVersionBarrier, points: PointStoreApi,
  onAuthExpired?: () => void, callbacks: { onObservation?: (observation: CanvasRunObservation) => void; onMonitorError?: (error: unknown, attempts: number) => void } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refunds = new Set<ReturnType<typeof setTimeout>>();
  let inFlight = false;
  let controller: AbortController | undefined;
  let revision = 0;
  let errors = 0;
  let stopped = true;
  const refreshPoints = () => { void points.getState().actions.updateUserPoint(); };
  const stop = () => {
    stopped = true; revision++; clearTimeout(timer); timer = undefined;
    controller?.abort(); controller = undefined;
    refunds.forEach(clearTimeout); refunds.clear();
  };
  const schedule = (wait: number) => { timer = setTimeout(() => { timer = undefined; void poll(); }, wait); };
  async function poll() {
    if (stopped || inFlight) return;
    const current = revision; const canvasId = store.getState().canvasId;
    inFlight = true; controller = new AbortController();
    try {
      const response: any = await barrier.runPolling(
        () => {
          if (stopped || current !== revision) throw new Error('Canvas monitor stopped');
          return getFlowData({ id: canvasId }, { signal: controller!.signal, silentError: true, onAuthExpired });
        },
        result => {
          if (stopped || current !== revision) return false;
          const version = result?.data?.versionNumber;
          try {
            const graph = JSON.parse(result?.data?.data);
            if (!Array.isArray(graph.nodes) || typeof result?.data?.taskStatus !== 'string') return false;
          } catch { return false; }
          if (!isTrustedCanvasVersion(version)) return false;
          store.getState().actions.setVersionNumber(version);
          return true;
        });
      if (stopped || current !== revision) return;
      const data = response.data;
      const graph = JSON.parse(data.data);
      if (!Array.isArray(graph.nodes) || typeof data.taskStatus !== 'string') throw new Error('Invalid canvas task result');
      errors = 0;
      try { callbacks.onObservation?.({ version: String(data.versionNumber), taskStatus: data.taskStatus, nodes: graph.nodes }); }
      catch (error) { console.error('Canvas generation observer failed:', error); }
      const failed = store.getState().actions.updateNodesMap(graph.nodes);
      // Set status last: the context subscription may stop this controller immediately.
      store.getState().actions.setStatus(data.taskStatus);
      if (failed || data.taskStatus === 'SUCCESS') {
        refreshPoints();
        const refund = setTimeout(() => { refunds.delete(refund); refreshPoints(); }, 5000);
        refunds.add(refund);
      }
      if (data.taskStatus === 'RUNNING' && !stopped) schedule(3000);
    } catch (error) {
      if (stopped || current !== revision) return;
      errors++;
      try { callbacks.onMonitorError?.(error, errors); } catch (observerError) { console.error('Canvas generation error observer failed:', observerError); }
      // Notify readiness without treating local monitoring failure as proven backend failure.
      store.setState({});
      if (errors >= 6) {
        store.getState().actions.updateAllNodeStatus();
        store.getState().actions.setStatus('FAILURE');
        refreshPoints();
      } else schedule(10000);
    } finally {
      inFlight = false;
      if (!stopped && !timer && store.getState().status === 'RUNNING') schedule(200);
    }
  }
  return {
    reconcile: () => {
      if (store.getState().status !== 'RUNNING') { if (!stopped) { stopped = true; revision++; clearTimeout(timer); timer = undefined; } return; }
      if (stopped) { stopped = false; errors = 0; revision++; }
      if (!timer && !inFlight) schedule(200);
    },
    isUnconfirmed: () => barrier.isUncertain(),
    stop,
  };
}
