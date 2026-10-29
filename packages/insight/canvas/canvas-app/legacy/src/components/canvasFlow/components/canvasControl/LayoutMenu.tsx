import { Columns3, LayoutGrid, Rows3 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useAutoLayoutMenu } from '../../hooks/useAutoLayoutMenu';

interface LayoutMenuProps {
  nodes: Node[] | undefined;
}

/** 多选顶栏 / 组操作栏共用的「排列」菜单（宫格 / 纵向 / 横向） */
const LayoutMenu = ({ nodes }: LayoutMenuProps) => {
  const { layoutMenuOpen, layoutMenuRef, toggleMenu, applyLayout } = useAutoLayoutMenu(nodes);

  return (
    <div className='relative' ref={layoutMenuRef}>
      <div
        onClick={toggleMenu}
        className={cn(
          'flex items-center gap-1.5 h-8 px-3 cursor-pointer rounded-lg transition-colors text-sm text-white whitespace-nowrap hover:bg-white/10',
          layoutMenuOpen && 'bg-white/10'
        )}
      >
        <LayoutGrid size={16} className='shrink-0' />
        <span>排列</span>
      </div>
      {layoutMenuOpen && (
        <div className='absolute left-0 top-[calc(100%+8px)] z-20 min-w-[180px] rounded-xl border border-white/10 bg-[#1f1f1f] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]'>
          <div
            onClick={() => applyLayout('vertical')}
            className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white cursor-pointer transition-colors hover:bg-white/10'
          >
            <Columns3 size={16} className='shrink-0' />
            <span>纵向排列</span>
          </div>
          <div
            onClick={() => applyLayout('horizontal')}
            className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white cursor-pointer transition-colors hover:bg-white/10'
          >
            <Rows3 size={16} className='shrink-0' />
            <span>横向排列</span>
          </div>
          <div onClick={() => applyLayout('grid')} className='flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white cursor-pointer transition-colors hover:bg-white/10'>
            <LayoutGrid size={16} className='shrink-0' />
            <span>宫格排列</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayoutMenu;
