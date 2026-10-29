export interface AssetItem {
  id: number;
  type: number;
  fileUrl: string;
  duration?: number;
}

export type HistorySelectKey = 'id' | 'fileUrl';

export const getHistorySelectKey = (asset: AssetItem, selectKey: HistorySelectKey) => String(asset[selectKey]);
