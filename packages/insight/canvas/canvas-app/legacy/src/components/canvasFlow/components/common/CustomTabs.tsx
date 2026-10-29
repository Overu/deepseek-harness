import React, { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface CustomTabItem {
  key: string;
  label: string;
  content?: React.ReactNode;
  tip?: string;
  disabled?: boolean;
}

interface CustomTabsProps {
  tabs: CustomTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  width?: number; // 总宽度，单位为px
}

const CustomTabs: React.FC<CustomTabsProps> = ({ tabs, activeKey, onChange, width }) => {
  const padding = 2;

  const handleTabChange = (tab: CustomTabItem) => {
    if (tab.disabled) return;
    onChange(tab.key);
  };

  const totalWidth = useMemo(() => {
    if (width) return width - 4;
    else return null;
  }, [width]);

  // 计算每个tab的平均宽度
  const getTabWidthStyle = (tab: CustomTabItem) => {
    const avgWidth = totalWidth ? totalWidth / tabs.length : 100 / tabs.length;
    return {
      width: totalWidth ? `${avgWidth}px` : `${avgWidth}%`,
      cursor: tab.disabled ? 'not-allowed' : 'pointer',
      ...(tab.disabled ? { color: 'rgba(255, 255, 255, 0.25)' } : {}),
    };
  };

  // 获取滑块的位置
  const getSliderPosition = () => {
    const index = tabs.findIndex(t => t.key === activeKey);
    const tabWidth = totalWidth ? totalWidth / tabs.length : 100 / tabs.length;
    const position = index * tabWidth; // 内边距在百分比情况下也需要相应调整

    return totalWidth ? `${position}px` : `${position}%`;
  };

  return (
    <div className='relative mb-4 m-auto' style={{ width: width ? `${width}px` : '100%' }}>
      <div className='h-10 rounded-lg w-full' style={{ paddingLeft: padding, paddingRight: padding }}>
        <div className='flex h-full relative bg-black/45 items-center rounded-lg'>
          <TooltipProvider delayDuration={100}>
            {tabs.map(tab => {
              const button = (
                <button
                  className={`h-9 leading-9 text-center text-sm font-medium relative z-10 transition-colors shrink-0 ${!tab.disabled ? 'text-white hover:bg-white/10 hover:rounded-lg' : ''}`}
                  style={getTabWidthStyle(tab)} // 动态设置宽度
                  onClick={() => handleTabChange(tab)}
                >
                  <span className='w-full block truncate'>{tab.label}</span>
                </button>
              );
              return tab.disabled ? (
                <Tooltip key={tab.key}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent>
                    <p>{tab.tip || tab.label}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <React.Fragment key={tab.key}>{button}</React.Fragment>
              );
            })}
          </TooltipProvider>
          {/* 滑块槽 */}
          <div
            className={`h-9 absolute top-[2px] bg-white/25 rounded-lg transition-all duration-200 ease-in-out shrink-0`}
            style={{
              left: getSliderPosition(),
              width: totalWidth ? `${totalWidth / tabs.length}px` : `${100 / tabs.length}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CustomTabs;
