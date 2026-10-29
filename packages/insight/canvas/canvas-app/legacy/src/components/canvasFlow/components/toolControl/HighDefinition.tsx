import React, { useState, useMemo } from 'react';
import styles from '../index.module.less';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import SendButton from '../promptControl/SendButton';

interface HighDefinitionProps {
  textList?: string[]; // 传入的文本列表
  imageList?: string[]; // 传入的图片列表
  status: string; // 任务状态
  onParamsChange?: (params: Params) => void; // 参数变化回调
  initialResolution?: string; // 初始分辨率
  caculatePoint: number; // 计算的赛点值
  pointLoading?: boolean; // 计算赛点loading
  execute: boolean; // 执行状态
  onLayerClick: (imageList: string[] | undefined, params: Params) => void; // 点击回调
  /** 账号工具权限不足 */
  permissionDisabled?: boolean;
}

const selectList = [
  {
    value: '2K',
    label: '2K',
  },
  {
    value: '4K',
    label: '4K',
  },
  {
    value: '6K',
    label: '6K',
  },
];

interface Params {
  resolution?: string;
  taskId?: string;
}

const HighDefinition: React.FC<HighDefinitionProps> = ({
  imageList,
  status,
  onParamsChange,
  initialResolution,
  caculatePoint,
  pointLoading = false,
  execute,
  onLayerClick,
  permissionDisabled = false,
}) => {
  const [selectOptions] = useState([...selectList]);
  const [selectValue, setSelectValue] = useState(initialResolution || '2K');

  // 计算是否允许发送
  const allowSend = useMemo(() => {
    if (permissionDisabled || status === 'running' || !imageList || !imageList.length || execute) {
      return false;
    } else {
      return true;
    }
  }, [imageList, status, execute, permissionDisabled]);

  // 定义参数对象
  const params: Params = {
    resolution: selectValue,
  };

  return (
    <div className='flex items-center justify-between gap-2 text-sm p-1'>
      <div className='whitespace-nowrap text-nowrap pl-2'>高清分辨率</div>
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
      <SendButton isExcute={execute} allowSend={allowSend} caculatePoint={caculatePoint} onClick={() => onLayerClick(imageList, params)} pointLoading={pointLoading} />
    </div>
  );
};

export default HighDefinition;
