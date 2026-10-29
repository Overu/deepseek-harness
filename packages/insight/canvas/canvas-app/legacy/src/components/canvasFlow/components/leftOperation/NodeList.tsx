import { Image, SquarePlay, Volume2 } from 'lucide-react';
import styles from '../index.module.less';
import setting from '../../settings/setting';
import { useMemo } from 'react';
import { type Handle } from '@xyflow/react';

const { sourceTypeMap } = setting;
const defaultList = [
  {
    type: 'text',
    title: '文本',
    tip: '生成或输入文本内容',
    icon: <div className='icon-text iconfont text-xl' />,
  },
  {
    type: 'image',
    title: '图片',
    tip: '生成或上传图片内容',
    icon: <Image size={20} />,
  },
  {
    type: 'video',
    title: '视频',
    tip: '生成或上传视频内容',
    icon: <SquarePlay size={20} />,
  },
  {
    type: 'audio',
    title: '音频',
    tip: '生成或上传音频内容',
    icon: <Volume2 size={20} />,
  },
];

interface NodeListProps {
  fromHandle?: Handle | null;
  onAdd: (type: string) => void;
}

const NodeList = ({ fromHandle, onAdd }: NodeListProps) => {
  const nodeList = useMemo(() => {
    if (fromHandle) {
      const actualList: any[] = [];
      const type = fromHandle.id?.split('_')[0] || '';
      let allowTypeArray: string[];
      if (fromHandle.type == 'source') {
        allowTypeArray = sourceTypeMap[type as keyof typeof sourceTypeMap];
      } else {
        allowTypeArray = [type];
      }
      defaultList.forEach(item => {
        if (allowTypeArray.includes(item.type)) {
          actualList.push(item);
        }
      });
      return actualList;
    } else {
      return defaultList;
    }
  }, [fromHandle]);

  return (
    <div className={`flex flex-col rounded-lg w-[272px] border border-[#595959] ${styles.bg}`}>
      <div className='px-4 py-3 border-b border-white/5 bg-[#262626] text-white text-sm rounded-t-lg'>基础节点</div>
      {nodeList.map(item => {
        return (
          <button className={styles.nodeItem} onClick={() => onAdd(item.type)} key={item.type}>
            {item.icon}
            <div className='flex flex-col gap-1'>
              <div className='text-sm text-white'>{item.title}</div>
              <div className='text-xs text-white/65'>{item.tip}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default NodeList;
