import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compressImage } from '@/utils';

export type UploadSuccessMeta = {
  file: File;
  preview?: string;
};

interface UseImageLocalPreviewOptions {
  remoteUrl?: string;
  enabled?: boolean;
}

export type RemoteImageStatus = 'idle' | 'loading' | 'retrying' | 'ready' | 'error';

interface RemoteImageState {
  url?: string;
  status: RemoteImageStatus;
  attempt: number;
}

const REMOTE_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

const createRemoteState = (url?: string): RemoteImageState => ({
  url,
  status: url ? 'loading' : 'idle',
  attempt: 0,
});

/**
 * 用于图片节点：上传成功后先展示本地 blob(objectURL) 预览，
 * 远端图片在真实 DOM 中加载成功后再释放 objectURL。
 */
export function useImageLocalPreview({ remoteUrl, enabled = true }: UseImageLocalPreviewOptions) {
  const activeRemoteUrl = enabled ? remoteUrl : undefined;
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | undefined>(undefined);
  const [remoteState, setRemoteState] = useState<RemoteImageState>(() => createRemoteState(activeRemoteUrl));
  const localPreviewRef = useRef<string | undefined>(undefined);
  const localPreviewTargetUrlRef = useRef<string | undefined>(undefined);
  const activeRemoteUrlRef = useRef(activeRemoteUrl);
  const activeRequestKeyRef = useRef('');

  const replaceLocalPreview = useCallback((next?: string, targetRemoteUrl?: string) => {
    const prev = localPreviewRef.current;
    if (prev === next) {
      localPreviewTargetUrlRef.current = next ? targetRemoteUrl : undefined;
      return;
    }
    if (prev) URL.revokeObjectURL(prev);
    localPreviewRef.current = next;
    localPreviewTargetUrlRef.current = next ? targetRemoteUrl : undefined;
    setLocalPreviewUrl(next);
  }, []);

  const currentRemoteState = remoteState.url === activeRemoteUrl ? remoteState : createRemoteState(activeRemoteUrl);
  const remoteStatus = currentRemoteState.status;
  const remoteAttempt = currentRemoteState.attempt;
  const remoteRequestKey = `${activeRemoteUrl || ''}:${remoteAttempt}`;

  useLayoutEffect(() => {
    activeRemoteUrlRef.current = activeRemoteUrl;
    setRemoteState(current => (current.url === activeRemoteUrl ? current : createRemoteState(activeRemoteUrl)));
  }, [activeRemoteUrl]);

  useLayoutEffect(() => {
    activeRequestKeyRef.current = remoteRequestKey;
  }, [remoteRequestKey]);

  useEffect(() => {
    if (remoteState.url !== activeRemoteUrl || remoteState.status !== 'retrying') return;
    const failedAttempt = remoteState.attempt;
    const retryDelay = REMOTE_RETRY_DELAYS_MS[failedAttempt];
    if (retryDelay === undefined) return;

    const timer = window.setTimeout(() => {
      setRemoteState(current => {
        if (activeRemoteUrlRef.current !== activeRemoteUrl) return current;
        if (current.url !== activeRemoteUrl || current.status !== 'retrying' || current.attempt !== failedAttempt) return current;
        return {
          ...current,
          status: 'loading',
          attempt: failedAttempt + 1,
        };
      });
    }, retryDelay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeRemoteUrl, remoteState]);

  const onRemoteLoad = useCallback(() => {
    if (!activeRemoteUrl) return;
    if (localPreviewRef.current && localPreviewTargetUrlRef.current !== activeRemoteUrl) return;
    if (activeRemoteUrlRef.current !== activeRemoteUrl || activeRequestKeyRef.current !== remoteRequestKey) return;

    setRemoteState(current => {
      if (activeRemoteUrlRef.current !== activeRemoteUrl || activeRequestKeyRef.current !== remoteRequestKey) return current;
      if (current.url === activeRemoteUrl && current.attempt > remoteAttempt) return current;
      return {
        url: activeRemoteUrl,
        status: 'ready',
        attempt: remoteAttempt,
      };
    });
  }, [activeRemoteUrl, remoteAttempt, remoteRequestKey]);

  const onRemoteError = useCallback(() => {
    if (!activeRemoteUrl) return;
    if (localPreviewRef.current && localPreviewTargetUrlRef.current !== activeRemoteUrl) return;
    if (activeRemoteUrlRef.current !== activeRemoteUrl || activeRequestKeyRef.current !== remoteRequestKey) return;

    setRemoteState(current => {
      if (activeRemoteUrlRef.current !== activeRemoteUrl || activeRequestKeyRef.current !== remoteRequestKey) return current;
      if (current.url === activeRemoteUrl && current.attempt > remoteAttempt) return current;
      return {
        url: activeRemoteUrl,
        status: remoteAttempt < REMOTE_RETRY_DELAYS_MS.length ? 'retrying' : 'error',
        attempt: remoteAttempt,
      };
    });
  }, [activeRemoteUrl, remoteAttempt, remoteRequestKey]);

  // 远端图片已经在真实 DOM 中可见后，再释放本地预览。
  useEffect(() => {
    if (remoteStatus === 'ready' && localPreviewRef.current && localPreviewTargetUrlRef.current === activeRemoteUrl) {
      replaceLocalPreview(undefined);
    }
  }, [activeRemoteUrl, remoteStatus, replaceLocalPreview]);

  // 卸载兜底释放 objectURL
  useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    };
  }, []);

  const remoteSrc = useMemo(() => (activeRemoteUrl ? compressImage(activeRemoteUrl) : undefined), [activeRemoteUrl]);

  const measureSrc = useMemo(() => {
    // 尺寸计算优先用本地预览（更快），否则用远端
    return localPreviewUrl && remoteStatus !== 'ready' ? localPreviewUrl : activeRemoteUrl;
  }, [activeRemoteUrl, localPreviewUrl, remoteStatus]);

  const setLocalPreviewFromMeta = useCallback(
    (targetRemoteUrl: string, meta?: UploadSuccessMeta) => {
      if (!enabled || !meta?.preview) return;
      replaceLocalPreview(meta.preview, targetRemoteUrl);
      setRemoteState(createRemoteState(targetRemoteUrl));
    },
    [enabled, replaceLocalPreview]
  );

  return {
    localPreviewSrc: localPreviewUrl,
    remoteSrc,
    remoteStatus,
    remoteAttempt,
    measureSrc,
    setLocalPreviewFromMeta,
    onRemoteLoad,
    onRemoteError,
  };
}
