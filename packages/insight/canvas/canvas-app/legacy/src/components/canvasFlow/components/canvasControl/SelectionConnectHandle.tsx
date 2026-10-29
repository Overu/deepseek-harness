import { Plus } from 'lucide-react';

export const selectionConnectHandleClassName =
  'flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-white/25 text-white shadow-md transition-colors hover:bg-[#4155F0] hover:border-[#4155F0]';

/** 多选右侧加号视觉（无交互） */
export const SelectionConnectHandleVisual = ({ className }: { className?: string }) => (
  <div className={className ? `${selectionConnectHandleClassName} ${className}` : selectionConnectHandleClassName}>
    <Plus size={14} />
  </div>
);

interface SelectionConnectHandleProps {
  onPointerDown: (event: React.PointerEvent) => void;
}

/** 多选右侧居中加号：按住拖拽发起批量连线 */
const SelectionConnectHandle = ({ onPointerDown }: SelectionConnectHandleProps) => {
  return (
    <button
      type='button'
      className={selectionConnectHandleClassName}
      aria-label='批量连线'
      onPointerDown={e => {
        e.stopPropagation();
        e.preventDefault();
        onPointerDown(e);
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
      <Plus size={14} />
    </button>
  );
};

export default SelectionConnectHandle;
