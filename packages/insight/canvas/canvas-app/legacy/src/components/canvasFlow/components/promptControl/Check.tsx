import React, { forwardRef } from 'react';

export interface CheckProps {
  checked?: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
  onClick?: (e: React.MouseEvent) => void;
  onSwitchClick?: (e: React.MouseEvent) => void;
  activeColor?: string;
}

export const Check = forwardRef<HTMLDivElement, CheckProps>(({ checked = false, label, onChange, onClick, onSwitchClick, activeColor = 'bg-[#4155F0]' }, ref) => {
  return (
    <div
      ref={ref}
      onClick={onClick ? onClick : () => onChange?.(!checked)}
      className='inline-flex items-center space-x-3 hover:bg-white/10 px-3 py-1.5 rounded-lg cursor-pointer transition-colors relative z-30'
    >
      <div
        onClick={e => {
          e.stopPropagation();
          if (onSwitchClick) {
            onSwitchClick(e);
          } else {
            onChange?.(!checked);
          }
        }}
        className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer flex items-center shrink-0 ${checked ? activeColor : 'bg-[#333]'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
      {label && <span className='text-gray-300 font-medium text-sm select-none'>{label}</span>}
    </div>
  );
});

Check.displayName = 'Check';

export default Check;
