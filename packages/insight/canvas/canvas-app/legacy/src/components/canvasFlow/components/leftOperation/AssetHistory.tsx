import { SideAssetList } from '@/components/Asset/SideAssetList';
import type { AddToCanvasItem } from './SideOperations';

interface HistoryProps {
  onAdd: (items: AddToCanvasItem[]) => void;
  refreshTrigger?: number;
}

const AssetHistory = ({ onAdd, refreshTrigger }: HistoryProps) => {
  return (
    <div className='w-[468px] h-[720px]'>
      <SideAssetList onAdd={onAdd} refreshTrigger={refreshTrigger} />
    </div>
  );
};

export default AssetHistory;
