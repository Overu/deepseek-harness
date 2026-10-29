import { useEffect, useRef, useState } from 'react';
import { calculateExternalTaskCost } from '@/api/tool';

type CostParams = Record<string, unknown>;

interface UseExternalTaskCostPointsArgs {
  selected: boolean;
  /**
   * 只在 key 真实变化时才会触发重新计算。
   * 用于屏蔽底部栏开合/重新选中造成的重复 effect。
   */
  costKey: string;
  /**
   * 基于当前输入构造 cost 请求参数。
   * 返回 null 表示当前输入不足，不发请求，赛点归 0。
   */
  buildCostParams: () => CostParams | null;
}

export function useExternalTaskCostPoints({ selected, costKey, buildCostParams }: UseExternalTaskCostPointsArgs) {
  const [caculatePoint, setCaculatePoint] = useState(0);
  const [pointLoading, setPointLoading] = useState(false);

  const seqRef = useRef(0);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!selected) return;

    const params = buildCostParams();
    // 入参不足时归零，且不锁定 lastKeyRef，避免「先连 A 再连 B」时 costKey 未变导致无法重算
    if (!params) {
      setCaculatePoint(0);
      lastKeyRef.current = '';
      return;
    }

    if (lastKeyRef.current === costKey) return;
    lastKeyRef.current = costKey;

    const run = async () => {
      const seq = ++seqRef.current;
      setPointLoading(true);
      try {
        const { code, data: result }: any = await calculateExternalTaskCost(params as any);
        if (seq !== seqRef.current) return;
        if (code === 'SUCCESS' && result != null) setCaculatePoint(result);
        else setCaculatePoint(0);
      } catch {
        if (seq !== seqRef.current) return;
        setCaculatePoint(0);
      } finally {
        if (seq === seqRef.current) setPointLoading(false);
      }
    };

    run();
  }, [buildCostParams, costKey, selected]);

  return { caculatePoint, pointLoading };
}
