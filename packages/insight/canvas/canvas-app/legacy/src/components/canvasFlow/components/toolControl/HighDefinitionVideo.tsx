import React, { useState, useMemo } from 'react';
import styles from '../index.module.less';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import SendButton from '../promptControl/SendButton';

interface HighDefinitionVideoProps {
  textList?: string[]; // 传入的文本列表
  videoList?: string[]; // 传入的视频列表
  status: string; // 任务状态
  onParamsChange?: (params: Params) => void; // 参数变化回调
  initialResolution?: string; // 初始分辨率
  caculatePoint: number; // 计算的赛点值
  pointLoading?: boolean; // 计算赛点loading
  execute: boolean; // 执行状态
  onLayerClick: (videoList: string[] | undefined, params: Params) => void; // 点击回调
  permissionDisabled?: boolean;
}

const selectList = [
  {
    value: '720p',
    label: '720p',
  },
  {
    value: '1080p',
    label: '1080p',
  },
  {
    value: '1440p',
    label: '2K',
  },
  {
    value: '2160p',
    label: '4K',
  },
];

interface Params {
  resolution?: string;
  taskId?: string;
}

const HighDefinitionVideo: React.FC<HighDefinitionVideoProps> = ({
  videoList,
  status,
  onParamsChange,
  initialResolution,
  caculatePoint,
  pointLoading = false,
  execute, // apiStatus,
  onLayerClick,
  permissionDisabled = false,
}) => {
  const [selectOptions] = useState([...selectList]);
  const [selectValue, setSelectValue] = useState(initialResolution || '720p');

  // 计算是否允许发送
  const allowSend = useMemo(() => {
    if (permissionDisabled || status === 'running' || !videoList || !videoList.length || execute) {
      return false;
    } else {
      return true;
    }
  }, [videoList, status, execute, permissionDisabled]);

  // 定义参数对象
  const params: Params = {
    resolution: selectValue,
  };

  return (
    <div className='flex items-center justify-between gap-2 text-sm p-1'>
      <div className='whitespace-nowrap text-nowrap pl-2'>高清倍数</div>
      <Select
        value={selectValue || undefined}
        onValueChange={value => {
          setSelectValue(value);
          onParamsChange?.({ resolution: value });
        }}
      >
        <SelectTrigger className={styles.customSelect}>
          <SelectValue placeholder='请选择' />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map((option: any) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Separator className='mx-2 bg-white h-4' orientation='vertical' />
      <SendButton isExcute={execute} allowSend={allowSend} caculatePoint={caculatePoint} onClick={() => onLayerClick(videoList, params)} pointLoading={pointLoading} />
    </div>
  );
};

export default HighDefinitionVideo;
