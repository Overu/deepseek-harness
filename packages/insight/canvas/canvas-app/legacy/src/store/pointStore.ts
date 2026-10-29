import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { getCanvasViewBinding, type CanvasViewBinding } from '../../../src/canvas-service-binding';
import { accountBalance, type AccountBalanceData, type GiftPointVo } from '@/api/order';
import { readStoredAccessToken } from '@/utils/authSession';

export type RefreshReason = 'init' | 'display' | 'payment-success' | 'task-submit' | 'task-success' | 'task-failure-refund' | 'manual' | 'logout' | 'session-invalidated';

export interface RefreshOptions {
  force?: boolean;
  reason?: RefreshReason;
  staleTime?: number;
}

export interface PointBalance {
  rechargeBalance: number;
  giftBalance: number;
  totalPoint: number;
  expirePoint: number;
  giftPointVoList: GiftPointVo[];
}

export interface PointStore {
  point: number;
  needPoint: number;
  rechargeBalance: number;
  giftBalance: number;
  expirePoint: number;
  giftPointVoList: GiftPointVo[];
  pointLoading: boolean;
  pointError: string | null;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastRefreshReason: RefreshReason | null;
  actions: {
    setPoint: (newPoint: number) => void;
    setNeedPoint: (newPoint: number) => void;
    setExpirePoint: (newExpirePoint: number) => void;
    setGiftPointVoList: (newGiftPointVoList: GiftPointVo[]) => void;
    ensureUserPoint: (options?: RefreshOptions) => Promise<PointBalance | null>;
    refreshUserPoint: (options?: RefreshOptions) => Promise<PointBalance | null>;
    invalidateUserPoint: (reason?: RefreshReason) => void;
    resetUserPoint: (reason?: RefreshReason) => void;
    updateUserPoint: (options?: RefreshOptions) => Promise<void>;
  };
}

export const BALANCE_STALE_TIME_MS = 10_000;

const getBalanceOwnerKey = () => {
  try {
    return readStoredAccessToken()?.value || 'anonymous';
  } catch {
    return 'unknown';
  }
};

const getBalanceRequestTimestamp = () => String(Date.now());

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBalance = (data?: AccountBalanceData): PointBalance => {
  const rechargeBalance = toFiniteNumber(data?.rechargeBalance);
  const giftBalance = toFiniteNumber(data?.giftBalance);
  const giftPointVoList = Array.isArray(data?.giftPointVoList) ? data.giftPointVoList : [];
  const expirePoint = giftPointVoList.reduce((sum, item) => sum + toFiniteNumber(item.points), 0);

  return {
    rechargeBalance,
    giftBalance,
    totalPoint: rechargeBalance + giftBalance,
    expirePoint,
    giftPointVoList,
  };
};

const getCurrentSnapshot = (state: PointStore): PointBalance | null => {
  if (!state.lastSuccessAt) {
    return null;
  }

  return {
    rechargeBalance: state.rechargeBalance,
    giftBalance: state.giftBalance,
    totalPoint: state.point,
    expirePoint: state.expirePoint,
    giftPointVoList: state.giftPointVoList,
  };
};

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const errorLike = error as { message?: string; msg?: string };
    return errorLike.message || errorLike.msg || '获取积分失败';
  }

  return '获取积分失败';
};

export type PointStoreApi = StoreApi<PointStore>;
export function createPointStoreApi(getOwnerKey = getBalanceOwnerKey, requestOptions?: () => import('@/api/workflow').CanvasRequestOptions): PointStoreApi {
let inFlightBalanceRequest: Promise<PointBalance | null> | null = null;
let inFlightOwnerKey: string | null = null;
let inFlightForce = false;
let inFlightRequestId = 0;

  return createStore<PointStore>((set, get) => {
  const fetchUserPoint = async (options: RefreshOptions = {}): Promise<PointBalance | null> => {
    const ownerKey = getOwnerKey();
    const state = get();
    const staleTime = options.staleTime ?? BALANCE_STALE_TIME_MS;
    const now = Date.now();
    const shouldForce = options.force === true;

    if (!shouldForce && state.lastSuccessAt && now - state.lastSuccessAt < staleTime) {
      return getCurrentSnapshot(state);
    }

    if (inFlightBalanceRequest && inFlightOwnerKey === ownerKey && (!shouldForce || inFlightForce)) {
      return inFlightBalanceRequest;
    }

    set({
      pointLoading: true,
      pointError: null,
      lastRefreshReason: options.reason ?? 'manual',
    });

    const requestId = inFlightRequestId + 1;
    inFlightRequestId = requestId;
    inFlightOwnerKey = ownerKey;
    inFlightForce = shouldForce;
    inFlightBalanceRequest = accountBalance({ timestamp: getBalanceRequestTimestamp() }, requestOptions?.())
      .then(res => {
        if (inFlightRequestId !== requestId || getOwnerKey() !== ownerKey) {
          return getCurrentSnapshot(get());
        }

        if (res.code !== 'SUCCESS') {
          const message = res.message || res.msg || '获取积分失败';
          set({
            pointError: message,
            lastFetchedAt: Date.now(),
          });
          return getCurrentSnapshot(get());
        }

        const balance = normalizeBalance(res.data);
        set({
          point: balance.totalPoint,
          rechargeBalance: balance.rechargeBalance,
          giftBalance: balance.giftBalance,
          expirePoint: balance.expirePoint,
          giftPointVoList: balance.giftPointVoList,
          pointError: null,
          lastFetchedAt: Date.now(),
          lastSuccessAt: Date.now(),
          lastRefreshReason: options.reason ?? 'manual',
        });

        return balance;
      })
      .catch(error => {
        if (inFlightRequestId === requestId && getOwnerKey() === ownerKey) {
          set({
            pointError: getErrorMessage(error),
            lastFetchedAt: Date.now(),
          });
        }

        return getCurrentSnapshot(get());
      })
      .finally(() => {
        if (inFlightRequestId === requestId && getOwnerKey() === ownerKey) {
          set({ pointLoading: false });
          inFlightBalanceRequest = null;
          inFlightOwnerKey = null;
          inFlightForce = false;
        }
      });

    return inFlightBalanceRequest;
  };

  return {
    point: 0,
    needPoint: 0,
    rechargeBalance: 0,
    giftBalance: 0,
    expirePoint: 0,
    giftPointVoList: [],
    pointLoading: false,
    pointError: null,
    lastFetchedAt: null,
    lastSuccessAt: null,
    lastRefreshReason: null,
    actions: {
      setPoint: newPoint => set({ point: newPoint }),
      setNeedPoint: newPoint => set({ needPoint: newPoint }),
      setExpirePoint: newExpirePoint => set({ expirePoint: newExpirePoint }),
      setGiftPointVoList: newGiftPointVoList => set({ giftPointVoList: newGiftPointVoList }),
      ensureUserPoint: options => fetchUserPoint(options),
      refreshUserPoint: options => fetchUserPoint({ ...options, force: true }),
      invalidateUserPoint: reason =>
        set({
          lastFetchedAt: null,
          lastSuccessAt: null,
          lastRefreshReason: reason ?? 'manual',
        }),
      resetUserPoint: reason => {
        inFlightRequestId += 1;
        inFlightBalanceRequest = null;
        inFlightOwnerKey = null;
        inFlightForce = false;
        set({
          point: 0,
          rechargeBalance: 0,
          giftBalance: 0,
          expirePoint: 0,
          giftPointVoList: [],
          pointLoading: false,
          pointError: null,
          lastFetchedAt: null,
          lastSuccessAt: null,
          lastRefreshReason: reason ?? 'logout',
        });
      },
      updateUserPoint: async options => {
        await fetchUserPoint({ ...options, force: options?.force ?? true });
      },
    },
  };
  });
}
const defaultPoints = createPointStoreApi();
// A subscription facade delegates to the same vanilla Store, and scopes UI listeners to its view.
const viewPointApis = new WeakMap<CanvasViewBinding, PointStoreApi>();
function currentPointApi(): PointStoreApi {
  const binding = getCanvasViewBinding();
  if (!binding) return defaultPoints;
  let api = viewPointApis.get(binding);
  if (!api) {
    api = { ...binding.points, subscribe: listener => {
      const unsubscribe = binding.points.subscribe(listener);
      const untrack = binding.onRelease(unsubscribe);
      return () => { untrack(); unsubscribe(); };
    } };
    viewPointApis.set(binding, api);
  }
  return api;
}

function usePoints(): PointStore;
function usePoints<T>(selector: (state: PointStore) => T): T;
function usePoints<T>(selector?: (state: PointStore) => T): PointStore | T {
  return useStore<PointStoreApi, PointStore | T>(currentPointApi(), selector ?? (state => state));
}
export const usePointStore = Object.assign(usePoints, {
  getState: () => (currentPointApi()).getState(),
  getInitialState: () => (currentPointApi()).getInitialState(),
  setState: ((...args: any[]) => (currentPointApi()).setState(...args as [any])) as PointStoreApi['setState'],
  subscribe: (listener: Parameters<PointStoreApi['subscribe']>[0]) => (currentPointApi()).subscribe(listener),
});
