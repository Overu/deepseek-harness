import { memo, type CSSProperties } from 'react';
import LockedPermissionBadge from './LockedPermissionBadge';
import hooks from '../../hooks';

interface ToolCornerActionButtonProps {
  /** 工具类型，用于组件内部判断权限 */
  toolType: string;
  /** 可点击态：决定是否展示 icon/分隔线/hover 边框/脉冲动画 */
  active: boolean;
  label: string;
  icon?: React.ReactNode;
  onClick?: (event: React.MouseEvent) => void;
  /** 为 true 时阻止 pointer/click 冒泡，用于 tryConnect 等需与画布交互隔离的场景 */
  stopPropagation?: boolean;
  className?: string;
  style?: CSSProperties;
}

const ToolCornerActionButton = ({ toolType, active, label, icon, onClick, stopPropagation = false, className = '', style }: ToolCornerActionButtonProps) => {
  const { useToolPermissionDisabled } = hooks;
  const locked = useToolPermissionDisabled(toolType);
  const interactive = !locked && active;
  const showIcon = Boolean(icon) && interactive;
  const base = 'peer group h-14 px-4 rounded-[10px] bg-[#000000]/70 flex items-center duration-200 ring-white backdrop-blur-xl';
  const borderAndCursor = interactive ? 'gap-3 border-2 border-transparent hover:border-white cursor-pointer hover:bg-[#000000]/70' : 'cursor-default';
  const finalStyle: CSSProperties | undefined = interactive ? { ...(style || {}), animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' } : style;

  return (
    <div
      className={`${base} ${borderAndCursor} ${className}`.trim()}
      style={finalStyle}
      onPointerDown={interactive && stopPropagation ? event => event.stopPropagation() : undefined}
      onClick={
        interactive
          ? event => {
              if (stopPropagation) {
                event.stopPropagation();
              }
              onClick?.(event);
            }
          : undefined
      }
    >
      {locked ? (
        <div className='flex-1 flex items-center justify-center'>
          <LockedPermissionBadge />
        </div>
      ) : (
        <>
          {showIcon ? <div className='flex items-center justify-center text-white'>{icon}</div> : null}
          <div className={showIcon ? 'flex-1 border-l border-white/65 pl-3 flex flex-col items-center justify-center' : 'flex-1 flex flex-col items-center justify-center'}>
            <div className='text-base text-white whitespace-nowrap'>{label}</div>
          </div>
        </>
      )}
    </div>
  );
};

export default memo(ToolCornerActionButton);
