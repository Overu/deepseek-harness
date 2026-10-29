import defaultBg from '@/assets/images/default_flow.png';
import { compressImage } from '@/utils';
import SafeImage from '@/components/common/SafeImage';

interface Item {
  id: number | string;
  name: string;
  createTime?: string;
  updateTime?: string;
  thumbnailUrl: string;
}

interface TemplateItemProps {
  template: Item;
  onAdd: (id: number | string) => void;
  actionLabel?: string;
}

const TemplateItem = ({ template, onAdd, actionLabel = '点击加入画布' }: TemplateItemProps) => {
  return (
    <div className='relative group aspect-square rounded-lg  hover:shadow-lg transition-all duration-300 w-full'>
      {/* 内容展示区 */}
      <div className='w-full h-full flex flex-col items-center justify-center overflow-hidden rounded relative'>
        <SafeImage
          src={compressImage(template.thumbnailUrl || defaultBg)}
          fallbackSrc={defaultBg}
          fallbackNode={null}
          alt='asset'
          className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-110 cursor-pointer'
        />

        {/* 底部遮罩层 - 仅覆盖图片区域 */}
        <div
          className='absolute inset-0 bg-gray-900/70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center text-xs text-white cursor-pointer'
          onClick={() => onAdd(template.id)}
        >
          {actionLabel}
        </div>
      </div>

      {/* 模板名称 - 显示在图片下方 */}
      <div className='text-sm text-white truncate mt-1'>{template.name}</div>
    </div>
  );
};

export default TemplateItem;
